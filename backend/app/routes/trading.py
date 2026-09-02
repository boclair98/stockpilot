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
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import (
    SESSION_COOKIE,
    decode_session,
    optional_identity,
    require_identity,
)
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


def _websocket_scope(websocket: WebSocket) -> tuple[str, int]:
    """Return the distributed connection bucket for a quote socket."""

    session_cookie = websocket.cookies.get(SESSION_COOKIE)
    identity = decode_session(session_cookie)
    if identity:
        return (
            f"user:{identity.id}",
            settings.websocket_authenticated_limit,
        )
    forwarded = websocket.headers.get("cf-connecting-ip")
    client = forwarded or (websocket.client.host if websocket.client else "unknown")
    return f"ip:{client}", settings.websocket_anonymous_limit


async def _renew_websocket_slot(scope: str, token: str) -> None:
    """Keep a live socket counted while cleaning up abandoned connections."""

    interval = max(15, settings.websocket_lease_seconds // 3)
    while True:
        await asyncio.sleep(interval)
        if not await traffic_store.renew_connection_slot(
            scope, token, settings.websocket_lease_seconds
        ):
            return


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
        await session.execute(
            pg_insert(TradingAccount)
            .values(
                owner_id=owner,
                cash=Decimal("100000"),
                cash_krw=Decimal("100000000"),
            )
            .on_conflict_do_nothing(index_elements=[TradingAccount.owner_id])
        )
        row = (await session.execute(query)).scalar_one()
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
        raise HTTPException(
            503,
            "KIS 시세를 아직 불러오지 못했습니다.",
            headers={"Cache-Control": "no-store", "Retry-After": "5"},
        )
    return current


@router.get("/market-status")
async def market_status(response: Response) -> dict:
    response.headers["Cache-Control"] = "public, max-age=2, s-maxage=5, stale-while-revalidate=30"
    return kis_market.status()


@router.get("/rules")
async def simulation_rules(response: Response) -> dict:
    """Expose the simulation contract so the UI never hides important assumptions."""

    response.headers["Cache-Control"] = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600"
    return {
        "mode": settings.trading_mode.upper(),
        "isSimulation": settings.trading_mode.upper() == "SIMULATION",
        "initialCash": {"KRW": 100_000_000, "USD": 100_000},
        "fees": {
            "commissionRate": float(settings.simulation_fee_rate * 100),
            "krSellTaxRate": float(settings.simulation_kr_sell_tax_rate * 100),
            "slippage": "실제 호가 스프레드·수량·시장별 변동성을 반영한 결정적 시뮬레이션",
        },
        "orderTypes": [
            {"key": "MARKET", "label": "시장가", "description": "현재 시세 기준으로 즉시 가상 체결"},
            {"key": "LIMIT", "label": "지정가", "description": "희망 가격에 도달할 때만 체결"},
            {"key": "STOP", "label": "손절·돌파", "description": "감시 가격을 넘으면 시장가로 전환"},
            {"key": "STOP_LIMIT", "label": "조건부 지정가", "description": "감시 가격 도달 후 지정가 주문으로 전환"},
        ],
        "sessions": [
            {"market": "KR", "label": "KRX 정규장", "time": "09:00–15:30", "timezone": "Asia/Seoul"},
            {"market": "KR", "label": "NXT 프리마켓", "time": "08:00–08:50", "timezone": "Asia/Seoul"},
            {"market": "KR", "label": "NXT 메인마켓", "time": "09:00–15:20", "timezone": "Asia/Seoul"},
            {"market": "KR", "label": "NXT 애프터마켓", "time": "15:40–20:00", "timezone": "Asia/Seoul"},
            {"market": "US", "label": "미국 정규장", "time": "09:30–16:00 현지시간", "timezone": "America/New_York"},
        ],
        "calendar": {
            "krxSource": "https://global.krx.co.kr/contents/GLB/06/0602/0602020204/GLB0602020204T1.jsp",
            "nxtSource": "https://nextrade.co.kr/marketOverview/content.do",
            "usSource": "https://www.nasdaq.com/market-activity/stock-market-holiday-calendar",
            "policy": "거래소 휴장일과 서머타임은 공식 캘린더 기준으로 운영 점검하며, 가상주문은 시세 최신성·서비스 위험한도를 함께 검증합니다.",
        },
        "dataPolicy": {
            "maxQuoteAgeSeconds": settings.market_data_max_age_seconds,
            "staleOrderPolicy": "오래된 시세에서는 조건부 주문을 체결하지 않음",
            "source": "한국투자증권 KIS Open API",
        },
        "disclaimer": "실제 증권계좌와 연결되지 않는 교육용 가상투자 서비스입니다.",
    }


@router.get("/statement")
async def account_statement(
    response: Response,
    owner: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return an explainable account statement without exposing private holdings publicly."""

    response.headers["Cache-Control"] = "private, no-store"
    rules = await simulation_rules(Response())
    if not owner:
        return {
            "authenticated": False,
            "asOf": datetime.now(UTC).isoformat(),
            "rules": rules,
            "cash": {"KRW": 100_000_000, "USD": 100_000},
            "equity": {"KRW": 100_000_000, "USD": 100_000},
            "positions": [],
            "orders": [],
            "summary": {"marketValue": {"KRW": 0, "USD": 0}, "realizedPnl": {"KRW": 0, "USD": 0}, "costs": {"KRW": 0, "USD": 0}},
        }

    await process_open_orders(session, owner)
    wallet = await account(session, owner)
    positions = (
        await session.execute(
            sa.select(Position)
            .where(Position.owner_id == owner, Position.quantity > 0)
            .order_by(Position.symbol)
            .limit(100)
        )
    ).scalars().all()
    orders = (
        await session.execute(
            sa.select(TradeOrder)
            .where(TradeOrder.owner_id == owner)
            .order_by(TradeOrder.created_at.desc())
            .limit(100)
        )
    ).scalars().all()
    market_value = {"KRW": Decimal("0"), "USD": Decimal("0")}
    unrealized = {"KRW": Decimal("0"), "USD": Decimal("0")}
    position_rows: list[dict] = []
    for position in positions:
        instrument = await instrument_catalog.get(position.symbol, exchange=position.exchange)
        if not instrument:
            continue
        await kis_market.watch(instrument)
        quote = kis_market.quote(position.symbol, instrument.market, position.exchange)
        current = Decimal(str(quote["price"])) if quote and quote.get("price") is not None else Decimal(position.average_price)
        quantity = Decimal(position.quantity)
        average = Decimal(position.average_price)
        value = quantity * current
        profit = (current - average) * quantity
        market_value[instrument.currency] += value
        unrealized[instrument.currency] += profit
        position_rows.append({
            "symbol": position.symbol,
            "name": instrument.name,
            "market": instrument.market,
            "exchange": position.exchange,
            "currency": instrument.currency,
            "quantity": float(quantity),
            "averagePrice": float(average),
            "currentPrice": float(current),
            "marketValue": float(value),
            "unrealizedPnl": float(profit),
            "returnRate": float((profit / (average * quantity) * 100) if average and quantity else 0),
        })

    realized = {"KRW": Decimal("0"), "USD": Decimal("0")}
    costs = {"KRW": Decimal("0"), "USD": Decimal("0")}
    order_rows: list[dict] = []
    for order in orders:
        instrument = await instrument_catalog.get(order.symbol, exchange=order.exchange)
        currency = instrument.currency if instrument else "KRW"
        if order.realized_pnl is not None:
            realized[currency] += Decimal(order.realized_pnl)
        costs[currency] += Decimal(order.fee or 0) + Decimal(order.tax or 0)
        order_rows.append({
            "id": str(order.id),
            "symbol": order.symbol,
            "exchange": order.exchange,
            "side": order.side,
            "orderType": order.order_type,
            "quantity": float(order.quantity),
            "status": order.status,
            "fillPrice": float(order.fill_price) if order.fill_price is not None else None,
            "fee": float(order.fee or 0),
            "tax": float(order.tax or 0),
            "rejectReason": order.reject_reason,
            "createdAt": order.created_at.isoformat() if order.created_at else None,
        })

    cash = {"KRW": Decimal(wallet.cash_krw), "USD": Decimal(wallet.cash)}
    open_orders = sum(1 for order in orders if order.status in {"OPEN", "TRIGGERED"})
    control = await load_control(session)
    return {
        "authenticated": True,
        "asOf": datetime.now(UTC).isoformat(),
        "rules": rules,
        "cash": {key: float(value) for key, value in cash.items()},
        "equity": {key: float(cash[key] + market_value[key]) for key in cash},
        "positions": position_rows,
        "orders": order_rows,
        "summary": {
            "marketValue": {key: float(value) for key, value in market_value.items()},
            "unrealizedPnl": {key: float(value) for key, value in unrealized.items()},
            "realizedPnl": {key: float(value) for key, value in realized.items()},
            "costs": {key: float(value) for key, value in costs.items()},
            "filledOrders": sum(1 for order in orders if order.status == "FILLED"),
            "openOrders": open_orders,
            "rejectedOrders": sum(1 for order in orders if order.status == "REJECTED"),
        },
        "riskLimits": {
            "maxOpenOrders": control.max_open_orders,
            "maxDailyOrders": control.max_daily_orders,
            "maxOrderNotionalKRW": float(control.max_order_notional_krw),
            "maxOrderNotionalUSD": float(control.max_order_notional_usd),
            "tradingHalted": bool(control.halted),
        },
    }


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
    scope, limit = _websocket_scope(websocket)
    slot = await traffic_store.acquire_connection_slot(
        scope, limit, settings.websocket_lease_seconds
    )
    if not slot:
        # 1013 tells browsers to retry later; the client applies exponential
        # backoff so a burst of tabs cannot create a reconnect storm.
        await websocket.close(code=1013, reason="실시간 시세 연결이 많습니다.")
        return
    try:
        await websocket.accept()
    except Exception:
        # A browser can navigate away during the handshake. Release the lease
        # immediately so an abandoned handshake cannot occupy a slot until TTL.
        await traffic_store.release_connection_slot(scope, slot)
        raise
    queue = quote_fanout.subscribe()
    renew_task = asyncio.create_task(
        _renew_websocket_slot(scope, slot), name="quote-websocket-lease"
    )
    try:
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=25)
            except TimeoutError:
                # Even when a market is closed, a small heartbeat keeps the
                # browser and edge aware that the socket is still healthy.
                await websocket.send_json(
                    {"type": "heartbeat", "at": datetime.now(UTC).isoformat()}
                )
                continue
            await websocket.send_text(payload)
    except WebSocketDisconnect:
        pass
    finally:
        renew_task.cancel()
        await asyncio.gather(renew_task, return_exceptions=True)
        quote_fanout.unsubscribe(queue)
        await traffic_store.release_connection_slot(scope, slot)


