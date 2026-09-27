from decimal import Decimal
from uuid import uuid4

import pytest
from app.services.portfolio_snapshots import (
    combined_return_rate,
    record_daily_snapshot,
)
from sqlalchemy.dialects import postgresql


@pytest.mark.no_db
def test_combined_return_keeps_original_two_currency_weighting():
    assert combined_return_rate(Decimal("110000000"), Decimal("100000")) == Decimal("5.00")


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_snapshot_write_is_atomic_upsert_for_repeated_portfolio_reads():
    class CapturingSession:
        statement = None

        async def execute(self, statement):
            self.statement = statement

    session = CapturingSession()
    await record_daily_snapshot(session, uuid4(), Decimal("100000000"), Decimal("100000"))

    query = str(session.statement.compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT ON CONSTRAINT uq_portfolio_snapshot_owner_date DO UPDATE" in query
    assert "return_rate = excluded.return_rate" in query
