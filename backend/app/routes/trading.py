from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.core.order_integrity import normalize_idempotency_key, request_fingerprint
from app.core.traffic import traffic_store
from app.models import Position, ProtectionPlan, TradeOrder, TradingAccount
from app.services.audit import record_audit
from app.services.execution_quality import simulated_fill
from app.services.instrument_catalog import Instrument, instrument_catalog
from app.services.kis_market import kis_market
from app.services.risk_engine import assess_pretrade, load_control, quote_age_seconds

router = APIRouter(prefix="/api/trading", tags=["trading"])


class QuoteFanout:
    """Serialize each market tick once, then fan it out to every connected client."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._task: asyncio.Task | None = None

    def subscribe(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1)
        self._subscribers.add(queue)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="quote-websocket-fanout")
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        self._subscribers.discard(queue)

    async def _run(self) -> None:
        while True:
            if not self._subscribers:
                await asyncio.sleep(0.5)
                continue
            try:
                rows = await kis_market.shared_snapshot()
            except Exception:
                rows = kis_market.snapshot()
            payload = json.dumps(
                {"type": "quotes", "data": rows, "status": kis_market.status()},
                ensure_ascii=False,
                separators=(",", ":"),
            )
            for queue in tuple(self._subscribers):
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                queue.put_nowait(payload)
            await asyncio.sleep(1)


quote_fanout = QuoteFanout()


def simulation_charges(
    total: Decimal, currency: str, side: str
) -> tuple[Decimal, Decimal]:
    fee = total * settings.simulation_fee_rate
    tax = (
        total * settings.simulation_kr_sell_tax_rate
        if currency == "KRW" and side == "SELL"
        else Decimal("0")
    )
    return fee, tax


def order_state(
    order_type: str,
    status: str,
    side: str,
    price: Decimal,
    limit_price: Decimal | None,
    trigger_price: Decimal | None,
) -> tuple[str, bool]:
    if order_type == "MARKET":
        return status, True
    if order_type == "LIMIT":
        crosses = bool(
            limit_price is not None
            and (
                (side == "BUY" and price <= limit_price)
                or (side == "SELL" and price >= limit_price)
            )
        )
        return status, crosses

    triggered = status == "TRIGGERED" or bool(
        trigger_price is not None
        and (
            (side == "BUY" and price >= trigger_price)
            or (side == "SELL" and price <= trigger_price)
        )
    )
    if not triggered:
        return "OPEN", False
    if order_type == "STOP":
        return "TRIGGERED", True

    crosses = bool(
        limit_price is not None
        and (
            (side == "BUY" and price <= limit_price)
            or (side == "SELL" and price >= limit_price)
        )
    )
    return "TRIGGERED", crosses


async def account(
    session: AsyncSession, owner: UUID, *, lock: bool = False
) -> TradingAccount:
    query = sa.select(TradingAccount).where(TradingAccount.owner_id == owner)
    if lock:
        query = query.with_for_update()
    row = (await session.execute(query)).scalar_one_or_none()
    if not row:
        row = TradingAccount(
            owner_id=owner, cash=Decimal("100000"), cash_krw=Decimal("100000000")
        )
        session.add(row)
        await session.flush()
    return row


def quantity_text(value: Decimal) -> str:
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def sell_quantity_error(
    held: Decimal, reserved: Decimal, requested: Decimal
) -> tuple[Decimal, str | None]:
    available = max(Decimal("0"), held - reserved)
    if held <= 0:
        return available, "보유하지 않은 종목은 매도할 수 없습니다."
    if requested > available:
        if reserved > 0:
            return (
                available,
                f"매도 가능 수량은 {quantity_text(available)}주입니다. "
                f"대기 중인 매도 주문 {quantity_text(reserved)}주를 확인해 주세요.",
            )
        return available, (
            "보유 수량보다 많이 매도할 수 없습니다. "
            f"최대 {quantity_text(available)}주까지 가능합니다."
        )
    return available, None


async def sell_capacity(
    session: AsyncSession,
    owner: UUID,
    symbol: str,
    exchange: str,
) -> tuple[Decimal, Decimal]:
    position = (
        await session.execute(
            sa.select(Position)
            .where(
                Position.owner_id == owner,
                Position.symbol == symbol,
                Position.exchange == exchange,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    pending_orders = (
        (
            await session.execute(
                sa.select(TradeOrder)
                .where(
                    TradeOrder.owner_id == owner,
                    TradeOrder.symbol == symbol,
                    TradeOrder.exchange == exchange,
                    TradeOrder.side == "SELL",
                    TradeOrder.status.in_(("OPEN", "TRIGGERED")),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    protection_quantity = (
        await session.execute(
            sa.select(sa.func.coalesce(sa.func.sum(ProtectionPlan.quantity), 0)).where(
                ProtectionPlan.owner_id == owner,
                ProtectionPlan.symbol == symbol,
                ProtectionPlan.exchange == exchange,
                ProtectionPlan.status == "ACTIVE",
            )
        )
    ).scalar_one()
    held = Decimal(position.quantity) if position else Decimal("0")
    reserved = sum((Decimal(item.quantity) for item in pending_orders), Decimal("0"))
    reserved += Decimal(protection_quantity)
    return held, reserved


async def execute(
    session: AsyncSession,
    order: TradeOrder,
    instrument: Instrument,
    price: Decimal,
    quote: dict | None = None,
) -> None:
    wallet = await account(session, order.owner_id, lock=True)
    position = (
        await session.execute(
            sa.select(Position)
            .where(
                Position.owner_id == order.owner_id,
                Position.symbol == order.symbol,
                Position.exchange == order.exchange,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    quantity = Decimal(order.quantity)
    quality = simulated_fill(
        reference_price=price,
        side=order.side,
        quantity=quantity,
        currency=instrument.currency,
        quote=quote or {"price": price},
        limit_price=(
            Decimal(order.limit_price)
            if order.order_type in {"LIMIT", "STOP_LIMIT"}
            and order.limit_price is not None
            else None
        ),
    )
    price = quality.price
    order.reference_price = quality.reference_price
    order.spread_bps = quality.spread_bps
    order.slippage_bps = quality.slippage_bps
    order.participation_rate = quality.participation_rate
    total = quantity * price
    fee, tax = simulation_charges(total, instrument.currency, order.side)
    cash_field = "cash_krw" if instrument.currency == "KRW" else "cash"
    available = Decimal(getattr(wallet, cash_field))

    if order.side == "BUY":
        debit = total + fee
        if available < debit:
            order.status = "REJECTED"
            return
        setattr(wallet, cash_field, available - debit)
        if not position:
            position = Position(
                owner_id=order.owner_id,
                symbol=order.symbol,
                exchange=order.exchange,
                quantity=0,
                average_price=0,
            )
            session.add(position)
        old_value = Decimal(position.quantity) * Decimal(position.average_price)
        position.quantity = Decimal(position.quantity) + quantity
        position.average_price = (old_value + debit) / Decimal(position.quantity)
    else:
        if not position or Decimal(position.quantity) < quantity:
            order.status = "REJECTED"
            return
        average_price = Decimal(position.average_price)
        position.quantity = Decimal(position.quantity) - quantity
        setattr(wallet, cash_field, available + total - fee - tax)
        order.realized_pnl = (price - average_price) * quantity - fee - tax

    order.status = "FILLED"
    order.fill_price = price
    order.fee = fee
    order.tax = tax


async def process_open_orders(session: AsyncSession, owner: UUID | None = None) -> None:
    control = await load_control(session)
    if control.halted or settings.trading_mode.upper() != "SIMULATION":
        return
    query = sa.select(TradeOrder).where(TradeOrder.status.in_(("OPEN", "TRIGGERED")))
    if owner:
        query = query.where(TradeOrder.owner_id == owner)
    orders = (await session.execute(query.with_for_update())).scalars().all()
    for order in orders:
        instrument = await instrument_catalog.get(order.symbol, exchange=order.exchange)
        quote = kis_market.quote(order.symbol, exchange=order.exchange)
        if not instrument or not quote:
            continue
        age = quote_age_seconds(quote)
        if age is None or age > settings.market_data_max_age_seconds:
            continue
        price = Decimal(str(quote["price"]))
        next_status, should_execute = order_state(
            order.order_type,
            order.status,
            order.side,
            price,
            Decimal(order.limit_price) if order.limit_price is not None else None,
            Decimal(order.trigger_price) if order.trigger_price is not None else None,
        )
        previous_status = order.status
        order.status = next_status
        if previous_status != next_status:
            record_audit(
                session,
                actor_id=order.owner_id,
                event_type="ORDER_TRIGGERED",
                entity_id=order.id,
                request_id=f"matcher:{order.id}",
                details={"from": previous_status, "status": next_status},
            )
        if should_execute:
            await execute(session, order, instrument, price, quote)
            record_audit(
                session,
                actor_id=order.owner_id,
                event_type=(
                    "ORDER_FILLED" if order.status == "FILLED" else "ORDER_REJECTED"
                ),
                entity_id=order.id,
                request_id=f"matcher:{order.id}",
                details={"fillPrice": str(order.fill_price), "status": order.status},
            )


class OrderIn(BaseModel):
    symbol: str
    market: str
    exchange: str
    side: str
    orderType: str = "MARKET"
    quantity: Decimal = Field(gt=0, le=10000)
    limitPrice: Decimal | None = Field(default=None, gt=0)
    triggerPrice: Decimal | None = Field(default=None, gt=0)


class ProtectionIn(BaseModel):
    symbol: str
    market: str
    exchange: str
    quantity: Decimal = Field(gt=0, le=10000)
    takeProfitPrice: Decimal = Field(gt=0)
    stopLossPrice: Decimal = Field(gt=0)


def order_receipt(
    row: TradeOrder, currency: str, *, replayed: bool = False
) -> dict:
    receipt = {
        "id": str(row.id),
        "status": row.status,
        "fillPrice": float(row.fill_price) if row.fill_price else None,
        "currency": currency,
        "replayed": replayed,
        "riskCode": row.risk_code,
        "executionQuality": {
            "referencePrice": (
                float(row.reference_price) if row.reference_price is not None else None
            ),
            "spreadBps": float(row.spread_bps) if row.spread_bps is not None else None,
            "slippageBps": (
                float(row.slippage_bps) if row.slippage_bps is not None else None
            ),
            "participationRate": (
                float(row.participation_rate)
                if row.participation_rate is not None
                else None
            ),
        },
    }
    if row.reject_reason:
        receipt["detail"] = row.reject_reason
    return receipt


@router.get("/quotes")
async def quotes(response: Response) -> list[dict]:
    response.headers["Cache-Control"] = "public, max-age=1, s-maxage=2, stale-while-revalidate=30"
    return await kis_market.shared_snapshot(top_only=True)


@router.get("/bootstrap")
async def bootstrap(response: Response) -> dict:
    response.headers["Cache-Control"] = "public, max-age=2, s-maxage=5, stale-while-revalidate=60"
    return {
        "quotes": await kis_market.shared_snapshot(top_only=True),
        "status": kis_market.status(),
        "kospi": await traffic_store.get_json("market:index:kospi"),
        "asOf": datetime.now(UTC).isoformat(),
    }


@router.get("/search")
async def search(
    response: Response,
    q: str = Query(min_length=1, max_length=60),
    market: str = Query(default="ALL", pattern="^(ALL|KR|US)$"),
    limit: int = Query(default=20, ge=1, le=30),
) -> dict:
    response.headers["Cache-Control"] = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600"
    items = await instrument_catalog.search(q, market, limit)
    return {"query": q, "total": len(items), "items": items}


@router.get("/quote")
async def quote(
    response: Response,
    symbol: str = Query(min_length=1, max_length=12),
    market: str = Query(pattern="^(KR|US)$"),
    exchange: str = Query(min_length=3, max_length=8),
) -> dict:
    response.headers["Cache-Control"] = "public, max-age=1, s-maxage=2, stale-while-revalidate=30"
    instrument = await instrument_catalog.get(symbol, market, exchange)
    if not instrument:
        raise HTTPException(404, "종목을 찾을 수 없습니다.")
    current = await kis_market.fetch_quote(instrument)
    if not current:
        raise HTTPException(503, "KIS 시세를 아직 불러오지 못했습니다.")
    return current


@router.get("/market-status")
async def market_status(response: Response) -> dict:
    response.headers["Cache-Control"] = "public, max-age=2, s-maxage=5, stale-while-revalidate=30"
    return kis_market.status()


@router.get("/kospi")
async def kospi(response: Response) -> dict:
    response.headers["Cache-Control"] = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600"
    return await kis_market.kospi_history()


@router.get("/portfolio")
async def portfolio(
    owner: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not owner:
        return {
            "authenticated": False,
            "cash": {"KRW": 100_000_000, "USD": 100_000},
            "positions": [],
            "orders": [],
            "protections": [],
        }

    await process_open_orders(session, owner)
    wallet = await account(session, owner)
    positions = (
        (await session.execute(sa.select(Position).where(Position.owner_id == owner)))
        .scalars()
        .all()
    )
    orders = (
        (
            await session.execute(
                sa.select(TradeOrder)
                .where(TradeOrder.owner_id == owner)
                .order_by(TradeOrder.created_at.desc())
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    protections = (
        (
            await session.execute(
                sa.select(ProtectionPlan)
                .where(ProtectionPlan.owner_id == owner)
                .order_by(ProtectionPlan.created_at.desc())
                .limit(30)
            )
        )
        .scalars()
        .all()
    )

    position_rows = []
    for position in positions:
        instrument = await instrument_catalog.get(
            position.symbol, exchange=position.exchange
        )
        if not instrument or not position.quantity:
            continue
        await kis_market.watch(instrument)
        current = kis_market.quote(
            position.symbol, instrument.market, position.exchange
        )
        current_price = (
            Decimal(str(current["price"]))
            if current
            else Decimal(position.average_price)
        )
        quantity = Decimal(position.quantity)
        average_price = Decimal(position.average_price)
        cost_basis = quantity * average_price
        market_value = quantity * current_price
        profit = market_value - cost_basis
        position_rows.append(
            {
                "symbol": position.symbol,
                "name": instrument.name,
                "market": instrument.market,
                "currency": instrument.currency,
                "exchange": position.exchange,
                "logoUrl": instrument.public().get("logoUrl"),
                "quantity": float(quantity),
                "averagePrice": float(average_price),
                "currentPrice": float(current_price),
                "costBasis": float(cost_basis),
                "marketValue": float(market_value),
                "profit": float(profit),
                "returnRate": float(
                    (profit / cost_basis * Decimal("100"))
                    if cost_basis
                    else Decimal("0")
                ),
            }
        )

    return {
        "authenticated": True,
        "cash": {"KRW": float(wallet.cash_krw), "USD": float(wallet.cash)},
        "positions": position_rows,
        "orders": [
            {
                "id": str(order.id),
                "symbol": order.symbol,
                "exchange": order.exchange,
                "side": order.side,
                "orderType": order.order_type,
                "quantity": float(order.quantity),
                "limitPrice": float(order.limit_price) if order.limit_price else None,
                "triggerPrice": (
                    float(order.trigger_price) if order.trigger_price else None
                ),
                "fillPrice": float(order.fill_price) if order.fill_price else None,
                "fee": float(order.fee),
                "tax": float(order.tax),
                "realizedPnl": (
                    float(order.realized_pnl)
                    if order.realized_pnl is not None
                    else None
                ),
                "referencePrice": (
                    float(order.reference_price)
                    if order.reference_price is not None
                    else None
                ),
                "spreadBps": (
                    float(order.spread_bps) if order.spread_bps is not None else None
                ),
                "slippageBps": (
                    float(order.slippage_bps)
                    if order.slippage_bps is not None
                    else None
                ),
                "participationRate": (
                    float(order.participation_rate)
                    if order.participation_rate is not None
                    else None
                ),
                "status": order.status,
                "createdAt": order.created_at.isoformat(),
            }
            for order in orders
        ],
        "protections": [
            {
                "id": str(plan.id),
                "symbol": plan.symbol,
                "exchange": plan.exchange,
                "quantity": float(plan.quantity),
                "takeProfitPrice": float(plan.take_profit_price),
                "stopLossPrice": float(plan.stop_loss_price),
                "status": plan.status,
                "triggerReason": plan.trigger_reason,
                "exitOrderId": str(plan.exit_order_id) if plan.exit_order_id else None,
                "triggeredAt": (
                    plan.triggered_at.isoformat() if plan.triggered_at else None
                ),
                "createdAt": plan.created_at.isoformat(),
            }
            for plan in protections
        ],
    }


@router.post("/orders", status_code=201, response_model=None)
async def order(
    payload: OrderIn,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
):
    try:
        replay_key = normalize_idempotency_key(idempotency_key)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    symbol = payload.symbol.upper()
    side = payload.side.upper()
    order_type = payload.orderType.upper()
    instrument = await instrument_catalog.get(
        symbol, payload.market.upper(), payload.exchange.upper()
    )
    valid_order_types = {"MARKET", "LIMIT", "STOP", "STOP_LIMIT"}
    if (
        not instrument
        or side not in {"BUY", "SELL"}
        or order_type not in valid_order_types
    ):
        raise HTTPException(422, "주문 값이 올바르지 않습니다.")
    if order_type in {"LIMIT", "STOP_LIMIT"} and payload.limitPrice is None:
        raise HTTPException(422, "지정가를 입력하세요.")
    if order_type in {"STOP", "STOP_LIMIT"} and payload.triggerPrice is None:
        raise HTTPException(422, "감시 가격을 입력하세요.")

    fingerprint = request_fingerprint(
        {
            "symbol": symbol,
            "exchange": instrument.exchange,
            "side": side,
            "orderType": order_type,
            "quantity": payload.quantity,
            "limitPrice": payload.limitPrice,
            "triggerPrice": payload.triggerPrice,
        }
    )
    existing = (
        await session.execute(
            sa.select(TradeOrder).where(
                TradeOrder.owner_id == owner,
                TradeOrder.idempotency_key == replay_key,
            )
        )
    ).scalar_one_or_none()
    if existing:
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(409, "같은 요청 키를 다른 주문에 다시 사용할 수 없습니다.")
        receipt = order_receipt(existing, instrument.currency, replayed=True)
        if existing.status == "REJECTED":
            receipt["detail"] = existing.reject_reason or "이 주문은 이미 거절 처리되었습니다."
            return JSONResponse(status_code=409, content=receipt)
        return JSONResponse(status_code=200, content=receipt)
    if side == "SELL":
        held, reserved = await sell_capacity(
            session, owner, symbol, instrument.exchange
        )
        _, error = sell_quantity_error(held, reserved, payload.quantity)
        if error:
            raise HTTPException(409, error)

    quote = await kis_market.fetch_quote(instrument)
    if not quote:
        raise HTTPException(503, "KIS 시세를 아직 수신하지 못했습니다.")
    price = Decimal(str(quote["price"]))
    limit_price = (
        Decimal(payload.limitPrice) if payload.limitPrice is not None else None
    )
    trigger_price = (
        Decimal(payload.triggerPrice) if payload.triggerPrice is not None else None
    )
    risk = await assess_pretrade(
        session,
        owner=owner,
        side=side,
        order_type=order_type,
        quantity=payload.quantity,
        currency=instrument.currency,
        quote=quote,
        limit_price=limit_price,
        trigger_price=trigger_price,
    )
    row = TradeOrder(
        owner_id=owner,
        idempotency_key=replay_key,
        request_fingerprint=fingerprint,
        symbol=symbol,
        exchange=instrument.exchange,
        side=side,
        order_type=order_type,
        quantity=payload.quantity,
        limit_price=payload.limitPrice,
        trigger_price=payload.triggerPrice,
        status="OPEN" if risk.allowed else "REJECTED",
        risk_code=None if risk.allowed else risk.code,
        reject_reason=None if risk.allowed else risk.message,
    )
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError as error:
        # A concurrent retry can race the optimistic lookup. The unique key
        # resolves that race; return the winner rather than executing twice.
        existing = (
            await session.execute(
                sa.select(TradeOrder).where(
                    TradeOrder.owner_id == owner,
                    TradeOrder.idempotency_key == replay_key,
                )
            )
        ).scalar_one_or_none()
        if not existing:
            raise HTTPException(
                409, "동일 주문이 처리 중입니다. 잠시 후 확인하세요."
            ) from error
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                409, "같은 요청 키를 다른 주문에 다시 사용할 수 없습니다."
            ) from error
        return JSONResponse(
            status_code=200,
            content=order_receipt(existing, instrument.currency, replayed=True),
        )

    request_id = request.state.request_id
    if not risk.allowed:
        record_audit(
            session,
            actor_id=owner,
            event_type="ORDER_RISK_REJECTED",
            entity_id=row.id,
            request_id=request_id,
            details={
                "code": risk.code,
                "reason": risk.message,
                "notional": str(risk.notional),
                "currency": instrument.currency,
            },
        )
        return JSONResponse(
            status_code=409,
            content=order_receipt(row, instrument.currency),
        )
    record_audit(
        session,
        actor_id=owner,
        event_type="ORDER_ACCEPTED",
        entity_id=row.id,
        request_id=request_id,
        details={
            "symbol": symbol,
            "exchange": instrument.exchange,
            "side": side,
            "orderType": order_type,
            "quantity": str(payload.quantity),
        },
    )

    row.status, should_execute = order_state(
        order_type,
        row.status,
        side,
        price,
        limit_price,
        trigger_price,
    )
    if should_execute:
        await execute(session, row, instrument, price, quote)
        if row.status == "REJECTED":
            detail = (
                "가상 예수금이 부족해 주문을 체결할 수 없습니다."
                if side == "BUY"
                else "보유 수량이 부족해 주문을 체결할 수 없습니다."
            )
            row.risk_code = (
                "INSUFFICIENT_CASH" if side == "BUY" else "INSUFFICIENT_POSITION"
            )
            row.reject_reason = detail
            record_audit(
                session,
                actor_id=owner,
                event_type="ORDER_REJECTED",
                entity_id=row.id,
                request_id=request_id,
                details={"reason": detail, "status": row.status},
            )
            receipt = order_receipt(row, instrument.currency)
            receipt["detail"] = detail
            # Returning (instead of raising) lets the transaction commit the
            # rejected order and its audit evidence while preserving HTTP 409.
            return JSONResponse(status_code=409, content=receipt)
        record_audit(
            session,
            actor_id=owner,
            event_type="ORDER_FILLED",
            entity_id=row.id,
            request_id=request_id,
            details={"fillPrice": str(row.fill_price), "status": row.status},
        )

    return order_receipt(row, instrument.currency)


@router.post("/protections", status_code=201)
async def create_protection(
    payload: ProtectionIn,
    request: Request,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    symbol = payload.symbol.upper()
    instrument = await instrument_catalog.get(
        symbol, payload.market.upper(), payload.exchange.upper()
    )
    if not instrument:
        raise HTTPException(404, "종목을 찾을 수 없습니다.")
    if payload.takeProfitPrice <= payload.stopLossPrice:
        raise HTTPException(422, "익절 가격은 손절 가격보다 높아야 합니다.")
    quote = await kis_market.fetch_quote(instrument)
    if not quote:
        raise HTTPException(503, "KIS 시세를 아직 수신하지 못했습니다.")
    current = Decimal(str(quote["price"]))
    if payload.takeProfitPrice <= current:
        raise HTTPException(422, "익절 가격은 현재가보다 높게 입력하세요.")
    if payload.stopLossPrice >= current:
        raise HTTPException(422, "손절 가격은 현재가보다 낮게 입력하세요.")
    held, reserved = await sell_capacity(
        session, owner, symbol, instrument.exchange
    )
    _, error = sell_quantity_error(held, reserved, payload.quantity)
    if error:
        raise HTTPException(409, error)
    plan = ProtectionPlan(
        owner_id=owner,
        symbol=symbol,
        exchange=instrument.exchange,
        quantity=payload.quantity,
        take_profit_price=payload.takeProfitPrice,
        stop_loss_price=payload.stopLossPrice,
        status="ACTIVE",
    )
    session.add(plan)
    await session.flush()
    record_audit(
        session,
        actor_id=owner,
        event_type="PROTECTION_CREATED",
        entity_id=plan.id,
        request_id=request.state.request_id,
        details={
            "symbol": symbol,
            "exchange": instrument.exchange,
            "quantity": str(payload.quantity),
            "takeProfitPrice": str(payload.takeProfitPrice),
            "stopLossPrice": str(payload.stopLossPrice),
        },
    )
    return {
        "id": str(plan.id),
        "status": plan.status,
        "symbol": symbol,
        "quantity": float(plan.quantity),
    }


@router.delete("/protections/{plan_id}")
async def cancel_protection(
    plan_id: UUID,
    request: Request,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    plan = (
        await session.execute(
            sa.select(ProtectionPlan)
            .where(ProtectionPlan.id == plan_id, ProtectionPlan.owner_id == owner)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "익절·손절 보호 설정을 찾을 수 없습니다.")
    if plan.status != "ACTIVE":
        raise HTTPException(409, "활성 상태인 보호 설정만 취소할 수 있습니다.")
    plan.status = "CANCELED"
    record_audit(
        session,
        actor_id=owner,
        event_type="PROTECTION_CANCELED",
        entity_id=plan.id,
        request_id=request.state.request_id,
        details={"status": plan.status},
    )
    return {"id": str(plan.id), "status": plan.status}


@router.delete("/orders/{order_id}")
async def cancel_order(
    order_id: UUID,
    request: Request,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (
        await session.execute(
            sa.select(TradeOrder)
            .where(TradeOrder.id == order_id, TradeOrder.owner_id == owner)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "가상주문을 찾을 수 없습니다.")
    if row.status not in {"OPEN", "TRIGGERED"}:
        raise HTTPException(409, "대기 중인 주문만 취소할 수 있습니다.")
    row.status = "CANCELED"
    record_audit(
        session,
        actor_id=owner,
        event_type="ORDER_CANCELED",
        entity_id=row.id,
        request_id=request.state.request_id,
        details={"previousStatus": "OPEN_OR_TRIGGERED", "status": row.status},
    )
    return {"id": str(row.id), "status": row.status}


@router.websocket("/ws")
async def websocket_quotes(websocket: WebSocket) -> None:
    await websocket.accept()
    queue = quote_fanout.subscribe()
    try:
        while True:
            await websocket.send_text(await queue.get())
    except WebSocketDisconnect:
        pass
    finally:
        quote_fanout.unsubscribe(queue)

