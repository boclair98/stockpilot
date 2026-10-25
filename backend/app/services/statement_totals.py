"""Bounded statement queries; display limits never truncate account totals."""

from decimal import Decimal, InvalidOperation

import sqlalchemy as sa
from fastapi import HTTPException

from app.models import Position, TradeOrder
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market


def exchange_currency(exchange):
    if exchange in {"KRX", "NXT"}:
        return "KRW"
    if exchange in {"NAS", "NYS", "AMS"}:
        return "USD"
    return None


async def position_batches(session, owner):
    """Read every holding with a bounded query and deterministic keyset."""
    after = None
    while True:
        query = sa.select(Position).where(
            Position.owner_id == owner, Position.quantity > 0
        )
        if after:
            query = query.where(
                sa.or_(
                    Position.symbol > after[0],
                    sa.and_(Position.symbol == after[0], Position.exchange > after[1]),
                )
            )
        rows = (
            (
                await session.execute(
                    query.order_by(Position.symbol, Position.exchange).limit(100)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return
        yield rows
        if len(rows) < 100:
            return
        after = (rows[-1].symbol, rows[-1].exchange)


async def order_totals(session, owner):
    """SQL aggregates all owner orders without loading the entire ledger."""
    rows = (
        await session.execute(
            sa.select(
                TradeOrder.exchange,
                TradeOrder.status,
                sa.func.count(),
                sa.func.coalesce(sa.func.sum(TradeOrder.realized_pnl), 0),
                sa.func.coalesce(sa.func.sum(TradeOrder.fee + TradeOrder.tax), 0),
            )
            .where(TradeOrder.owner_id == owner)
            .group_by(TradeOrder.exchange, TradeOrder.status)
        )
    ).all()
    realized = {"KRW": Decimal(0), "USD": Decimal(0)}
    costs = {"KRW": Decimal(0), "USD": Decimal(0)}
    counts = {}
    for exchange, status, count, pnl, cost in rows:
        currency = exchange_currency(exchange)
        if currency is None and (pnl or cost):
            # Do not silently label an unsupported legacy currency as won.
            raise HTTPException(
                503, "일부 거래의 통화를 확인하지 못했어요. 계좌 점검이 필요해요."
            )
        if currency:
            realized[currency] += Decimal(pnl)
            costs[currency] += Decimal(cost)
        counts[status] = counts.get(status, 0) + count
    return realized, costs, counts


async def holding_totals(session, owner):
    """Use already-received quotes; never fan out a request per holding."""
    values = {"KRW": Decimal(0), "USD": Decimal(0)}
    profits = {"KRW": Decimal(0), "USD": Decimal(0)}
    display = []
    count = estimated = 0
    async for batch in position_batches(session, owner):
        for position in batch:
            currency = exchange_currency(position.exchange)
            if currency is None:
                raise HTTPException(
                    503,
                    "일부 보유 종목의 통화를 확인하지 못했어요. 계좌 점검이 필요해요.",
                )
            market = "KR" if currency == "KRW" else "US"
            item = instrument_catalog.get_cached(
                position.symbol, market, position.exchange
            )
            quote = kis_market.quote(position.symbol, market, position.exchange)
            quantity, average = (
                Decimal(position.quantity),
                Decimal(position.average_price),
            )
            try:
                current = Decimal(str(quote["price"])) if quote else Decimal("NaN")
            except (InvalidOperation, TypeError, KeyError):
                current = Decimal("NaN")
            basis = "QUOTE"
            if not current.is_finite() or current <= 0:
                current, basis = average, "COST"
                estimated += 1
            value, profit = quantity * current, (current - average) * quantity
            values[currency] += value
            profits[currency] += profit
            count += 1
            if len(display) < 100:
                display.append(
                    {
                        "symbol": position.symbol,
                        "name": item.name if item else position.symbol,
                        "market": market,
                        "exchange": position.exchange,
                        "currency": currency,
                        "quantity": float(quantity),
                        "averagePrice": float(average),
                        "currentPrice": float(current),
                        "marketValue": float(value),
                        "unrealizedPnl": float(profit),
                        "returnRate": float(profit / (average * quantity) * 100)
                        if average
                        else 0,
                        "valuationBasis": basis,
                    }
                )
    return values, profits, display, count, estimated
