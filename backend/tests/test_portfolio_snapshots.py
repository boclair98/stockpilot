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
    owner = uuid4()

    class CapturingSession:
        def __init__(self):
            self.statements = []

        async def execute(self, statement):
            self.statements.append(statement)
            if statement.is_select:
                return [(owner, Decimal("10000000"), Decimal("-5000"))]
            return None

    session = CapturingSession()
    await record_daily_snapshot(session, owner, Decimal("110000000"), Decimal("95000"))

    flow_read, upsert = session.statements
    assert flow_read.is_select
    compiled = upsert.compile(dialect=postgresql.dialect())
    query = str(compiled)
    assert "ON CONFLICT ON CONSTRAINT uq_portfolio_snapshot_owner_date DO UPDATE" in query
    assert "return_rate = excluded.return_rate" in query
    assert compiled.params["owner_id"] == owner
    assert compiled.params["equity_krw"] == Decimal("110000000")
    assert compiled.params["equity_usd"] == Decimal("95000")
    assert compiled.params["return_rate"] == Decimal("0")
