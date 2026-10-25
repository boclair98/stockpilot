"""Read-only calendar: actual executions, bounded to one Korean calendar month."""

import re
from datetime import UTC, date, datetime, time
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.practice import require_practice_identity
from app.models import TradeOrder
from app.routes.order_history import DOMESTIC_EXCHANGES, US_EXCHANGES

router = APIRouter(prefix="/api/trading", tags=["trading"])
KST = ZoneInfo("Asia/Seoul")
METRICS = ("buyAmount", "sellAmount", "fees", "taxes", "realizedPnl")


def month_bounds(month: str) -> tuple[datetime, datetime]:
    try:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise ValueError
        year, number = map(int, month.split("-"))
        if not 1900 <= year <= 2100:
            raise ValueError
        start = date(year, number, 1)
        end = date(year + (number == 12), number % 12 + 1, 1)
        return tuple(
            datetime.combine(day, time.min, KST).astimezone(UTC) for day in (start, end)
        )
    except (ValueError, OverflowError) as exc:
        raise HTTPException(
            422,
            "조회 월을 YYYY-MM 형식으로 확인해 주세요.",
            headers={"Cache-Control": "private, no-store"},
        ) from exc


def activity_query(
    owner: UUID, start: datetime, end: datetime, as_of: datetime, dialect: str
):
    executed = sa.func.coalesce(TradeOrder.processed_at, TradeOrder.created_at)
    day = (
        sa.cast(sa.func.timezone("Asia/Seoul", executed), sa.Date)
        if dialect == "postgresql"
        else sa.func.date(executed, "+9 hours")
    ).label("day")
    currency = sa.case(
        (TradeOrder.exchange.in_(DOMESTIC_EXCHANGES), "KRW"),
        (TradeOrder.exchange.in_(US_EXCHANGES), "USD"),
        else_="UNKNOWN",
    ).label("currency")
    buy, sell = TradeOrder.side == "BUY", TradeOrder.side == "SELL"
    gross_valid = sa.and_(TradeOrder.fill_price > 0, TradeOrder.quantity > 0)
    gross = sa.cast(TradeOrder.fill_price * TradeOrder.quantity, sa.Numeric(28, 10))

    def count(condition):
        return sa.func.sum(sa.case((condition, 1), else_=0))

    expressions = [
        day,
        currency,
        sa.func.count().label("count"),
        count(buy).label("buyCount"),
        count(sell).label("sellCount"),
        count(TradeOrder.processed_at.is_(None)).label("legacyDateCount"),
    ]
    for name, value, applicable, valid in (
        ("buyAmount", gross, buy, gross_valid),
        ("sellAmount", gross, sell, gross_valid),
        ("fees", TradeOrder.fee, sa.true(), TradeOrder.fee >= 0),
        ("taxes", TradeOrder.tax, sa.true(), TradeOrder.tax >= 0),
        (
            "realizedPnl",
            TradeOrder.realized_pnl,
            sell,
            TradeOrder.realized_pnl.is_not(None),
        ),
    ):
        expressions.extend(
            (
                sa.func.sum(
                    sa.case((sa.and_(applicable, valid), value), else_=0)
                ).label(name),
                count(
                    sa.and_(applicable, sa.or_(sa.not_(valid), value.is_(None)))
                ).label(name + "Missing"),
            )
        )
    return (
        sa.select(*expressions)
        .where(
            TradeOrder.owner_id == owner,
            TradeOrder.status == "FILLED",
            TradeOrder.side.in_(("BUY", "SELL")),
            executed >= start,
            executed < end,
            executed <= as_of,
            TradeOrder.created_at <= as_of,
        )
        .group_by(day, currency)
        .order_by(day, currency)
        .limit(94)
    )


def _metric(value) -> float | None:
    number = Decimal(value or 0)
    return float(number) if number.is_finite() else None


@router.get("/activity")
async def trade_activity(
    response: Response,
    month: str = Query(..., max_length=7),
    owner: UUID = Depends(require_practice_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    start, end = month_bounds(month)
    as_of = datetime.now(UTC)
    records = (
        (
            await session.execute(
                activity_query(
                    owner, start, end, as_of, session.get_bind().dialect.name
                )
            )
        )
        .mappings()
        .all()
    )
    days: dict[str, dict] = {}
    # Decimal totals remain separate by currency until JSON serialization.
    totals = {
        currency: {
            "currency": currency,
            "count": 0,
            "buyCount": 0,
            "sellCount": 0,
            **{name: Decimal(0) for name in METRICS},
        }
        for currency in ("KRW", "USD")
    }
    for record in records:
        key = str(record["day"])
        day = days.setdefault(
            key,
            {
                "date": key,
                "currencies": [],
                "unknownCurrencyCount": 0,
                "legacyDateCount": 0,
            },
        )
        day["legacyDateCount"] += int(record["legacyDateCount"])
        if record["currency"] == "UNKNOWN":
            day["unknownCurrencyCount"] += int(record["count"])
            continue
        item = {name: int(record[name]) for name in ("count", "buyCount", "sellCount")}
        item["currency"] = record["currency"]
        total = totals[record["currency"]]
        for name in ("count", "buyCount", "sellCount"):
            total[name] += item[name]
        for name in METRICS:
            value = None if record[name + "Missing"] else _metric(record[name])
            item[name] = value
            total[name] = (
                None
                if total[name] is None or value is None
                else total[name] + Decimal(record[name] or 0)
            )
        day["currencies"].append(item)
    return {
        "month": month,
        "timezone": "Asia/Seoul",
        "basis": "execution",
        "asOf": as_of.isoformat(),
        "days": list(days.values()),
        "totals": [
            {
                **item,
                **{
                    name: _metric(item[name]) if item[name] is not None else None
                    for name in METRICS
                },
            }
            for item in totals.values()
        ],
        "unknownCurrencyCount": sum(
            day["unknownCurrencyCount"] for day in days.values()
        ),
        "legacyDateCount": sum(day["legacyDateCount"] for day in days.values()),
    }
