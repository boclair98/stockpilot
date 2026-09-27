"""Persist one return-rate observation per Seoul calendar day."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PortfolioDailySnapshot

INITIAL_KRW = Decimal("100000000")
INITIAL_USD = Decimal("100000")
SEOUL = timezone(timedelta(hours=9))


def combined_return_rate(equity_krw: Decimal, equity_usd: Decimal) -> Decimal:
    return (
        (equity_krw / INITIAL_KRW + equity_usd / INITIAL_USD) / Decimal("2")
        - Decimal("1")
    ) * Decimal("100")


async def record_daily_snapshot(
    session: AsyncSession,
    owner: UUID,
    equity_krw: Decimal,
    equity_usd: Decimal,
) -> None:
    """Update today's observation atomically across web and Toss requests."""

    values = {
        "id": uuid4(),
        "owner_id": owner,
        "snapshot_date": datetime.now(SEOUL).date(),
        "equity_krw": equity_krw,
        "equity_usd": equity_usd,
        "return_rate": combined_return_rate(equity_krw, equity_usd),
    }
    statement = pg_insert(PortfolioDailySnapshot).values(**values)
    await session.execute(
        statement.on_conflict_do_update(
            constraint="uq_portfolio_snapshot_owner_date",
            set_={
                "equity_krw": statement.excluded.equity_krw,
                "equity_usd": statement.excluded.equity_usd,
                "return_rate": statement.excluded.return_rate,
            },
        )
    )
