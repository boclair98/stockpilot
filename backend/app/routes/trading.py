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

from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.models import Position, TradeOrder, TradingAccount
from app.services.instrument_catalog import Instrument, instrument_catalog
from app.services.kis_market import kis_market

router = APIRouter(prefix="/api/trading", tags=["trading"])


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
    cash_field = "cash_krw" if instrument.currency == "KRW" else "cash"
    available = Decimal(getattr(wallet, cash_field))

    if order.side == "BUY":
        if available < total:
            order.status = "REJECTED"
            return
        setattr(wallet, cash_field, available - total)
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
        position.average_price = (old_value + total) / Decimal(position.quantity)
    else:
        if not position or Decimal(position.quantity) < quantity:
            order.status = "REJECTED"
            return
        position.quantity = Decimal(position.quantity) - quantity
        setattr(wallet, cash_field, available + total)

    order.status = "FILLED"
    order.fill_price = price


async def process_open_orders(session: AsyncSession, owner: UUID | None = None) -> None:
    query = sa.select(TradeOrder).where(TradeOrder.status == "OPEN")
    if owner:
        query = query.where(TradeOrder.owner_id == owner)
    orders = (await session.execute(query.with_for_update())).scalars().all()
    for order in orders:
        instrument = await instrument_catalog.get(
            order.symbol, exchange=order.exchange
        )
        quote = kis_market.quote(order.symbol, exchange=order.exchange)
        if not instrument or not quote or order.limit_price is None:
            continue
        price = Decimal(str(quote["price"]))
        limit_price = Decimal(order.limit_price)
        crosses = (order.side == "BUY" and price <= limit_price) or (
            order.side == "SELL" and price >= limit_price
        )
        if crosses:
            await execute(session, order, instrument, price)


class OrderIn(BaseModel):
    symbol: str
    market: str
    exchange: str
    side: str
    orderType: str = "MARKET"
    quantity: Decimal = Field(gt=0, le=10000)
    limitPrice: Decimal | None = Field(default=None, gt=0)


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
        position_rows.append(
            {
                "symbol": position.symbol,
                "name": instrument.name,
                "market": instrument.market,
                "currency": instrument.currency,
                "exchange": position.exchange,
                "quantity": float(position.quantity),
                "averagePrice": float(position.average_price),
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
                "fillPrice": float(order.fill_price) if order.fill_price else None,
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
    if not instrument or side not in {"BUY", "SELL"} or order_type not in {
        "MARKET",
        "LIMIT",
    }:
        raise HTTPException(422, "주문 값이 올바르지 않습니다.")
    if order_type == "LIMIT" and payload.limitPrice is None:
        raise HTTPException(422, "지정가를 입력하세요.")

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
    )
    session.add(row)
    await session.flush()

    crosses = (
        order_type == "MARKET"
        or (side == "BUY" and price <= Decimal(payload.limitPrice))
        or (side == "SELL" and price >= Decimal(payload.limitPrice))
    )
    if crosses:
        await execute(session, row, instrument, price)

    return {
        "id": str(row.id),
        "status": row.status,
        "fillPrice": float(row.fill_price) if row.fill_price else None,
        "currency": instrument.currency,
    }


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
