from __future__ import annotations

import asyncio
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.models import Position, TradeOrder, TradingAccount
from app.services.instrument_catalog import Instrument, instrument_catalog
from app.services.kis_market import kis_market

router = APIRouter(prefix="/api/trading", tags=["trading"])


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
    held = Decimal(position.quantity) if position else Decimal("0")
    reserved = sum(
        (Decimal(item.quantity) for item in pending_orders), Decimal("0")
    )
    return held, reserved


async def execute(
    session: AsyncSession,
    order: TradeOrder,
    instrument: Instrument,
    price: Decimal,
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
    query = sa.select(TradeOrder).where(
        TradeOrder.status.in_(("OPEN", "TRIGGERED"))
    )
    if owner:
        query = query.where(TradeOrder.owner_id == owner)
    orders = (await session.execute(query.with_for_update())).scalars().all()
    for order in orders:
        instrument = await instrument_catalog.get(
            order.symbol, exchange=order.exchange
        )
        quote = kis_market.quote(order.symbol, exchange=order.exchange)
        if not instrument or not quote:
            continue
        price = Decimal(str(quote["price"]))
        next_status, should_execute = order_state(
            order.order_type,
            order.status,
            order.side,
            price,
            Decimal(order.limit_price) if order.limit_price is not None else None,
            Decimal(order.trigger_price)
            if order.trigger_price is not None
            else None,
        )
        order.status = next_status
        if should_execute:
            await execute(session, order, instrument, price)


class OrderIn(BaseModel):
    symbol: str
    market: str
    exchange: str
    side: str
    orderType: str = "MARKET"
    quantity: Decimal = Field(gt=0, le=10000)
    limitPrice: Decimal | None = Field(default=None, gt=0)
    triggerPrice: Decimal | None = Field(default=None, gt=0)


@router.get("/quotes")
async def quotes() -> list[dict]:
    return kis_market.snapshot(top_only=True)


@router.get("/search")
async def search(
    q: str = Query(min_length=1, max_length=60),
    market: str = Query(default="ALL", pattern="^(ALL|KR|US)$"),
    limit: int = Query(default=20, ge=1, le=30),
) -> dict:
    items = await instrument_catalog.search(q, market, limit)
    return {"query": q, "total": len(items), "items": items}


@router.get("/quote")
async def quote(
    symbol: str = Query(min_length=1, max_length=12),
    market: str = Query(pattern="^(KR|US)$"),
    exchange: str = Query(min_length=3, max_length=8),
) -> dict:
    instrument = await instrument_catalog.get(symbol, market, exchange)
    if not instrument:
        raise HTTPException(404, "종목을 찾을 수 없습니다.")
    current = await kis_market.fetch_quote(instrument)
    if not current:
        raise HTTPException(503, "KIS 시세를 아직 불러오지 못했습니다.")
    return current


@router.get("/market-status")
async def market_status() -> dict:
    return kis_market.status()


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
            Decimal(str(current["price"])) if current else Decimal(position.average_price)
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
                "status": order.status,
                "createdAt": order.created_at.isoformat(),
            }
            for order in orders
        ],
    }


@router.post("/orders", status_code=201)
async def order(
    payload: OrderIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
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
    row = TradeOrder(
        owner_id=owner,
        symbol=symbol,
        exchange=instrument.exchange,
        side=side,
        order_type=order_type,
        quantity=payload.quantity,
        limit_price=payload.limitPrice,
        trigger_price=payload.triggerPrice,
    )
    session.add(row)
    await session.flush()

    row.status, should_execute = order_state(
        order_type,
        row.status,
        side,
        price,
        Decimal(payload.limitPrice) if payload.limitPrice is not None else None,
        Decimal(payload.triggerPrice) if payload.triggerPrice is not None else None,
    )
    if should_execute:
        await execute(session, row, instrument, price)
        if row.status == "REJECTED":
            if side == "BUY":
                raise HTTPException(409, "가상 예수금이 부족해 주문을 체결할 수 없습니다.")
            raise HTTPException(409, "보유 수량이 부족해 주문을 체결할 수 없습니다.")

    return {
        "id": str(row.id),
        "status": row.status,
        "fillPrice": float(row.fill_price) if row.fill_price else None,
        "currency": instrument.currency,
    }


@router.delete("/orders/{order_id}")
async def cancel_order(
    order_id: UUID,
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
    return {"id": str(row.id), "status": row.status}


@router.websocket("/ws")
async def websocket_quotes(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(
                {
                    "type": "quotes",
                    "data": kis_market.snapshot(),
                    "status": kis_market.status(),
                }
            )
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
