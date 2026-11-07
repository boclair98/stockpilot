"""Portfolio metadata checks with no database, account writes or quote requests."""

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from app.routes import trading
from fastapi import Request


class ReadOnlySession:
    def __init__(self, positions):
        self.rows = [positions, [], []]

    async def execute(self, statement):
        assert isinstance(statement, sa.sql.Select)
        rows = self.rows.pop(0)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))


async def isolated_portfolio(monkeypatch, positions, quotes):
    """Stub every existing mutating or external boundary; verify the pure response."""
    owner = uuid4()
    snapshots = []
    watched = []
    wallet = SimpleNamespace(cash_krw=Decimal("1000"), cash=Decimal("100"))

    async def no_processing(*args):
        pass

    async def read_wallet(*args):
        return wallet

    async def record_snapshot(session, actual_owner, krw, usd):
        assert actual_owner == owner
        snapshots.append((krw, usd))

    async def instrument(symbol, exchange):
        currency = "KRW" if exchange == "KRX" else "USD"
        return SimpleNamespace(
            name=symbol,
            market="KR" if currency == "KRW" else "US",
            currency=currency,
            public=lambda: {"logoUrl": None},
        )

    async def watch(item):
        watched.append(item)

    monkeypatch.setattr(trading, "process_open_orders", no_processing)
    monkeypatch.setattr(trading, "account", read_wallet)
    monkeypatch.setattr(trading, "record_daily_snapshot", record_snapshot)
    monkeypatch.setattr(trading, "current_identity", lambda request: None)
    monkeypatch.setattr(trading.instrument_catalog, "get", instrument)
    monkeypatch.setattr(trading.kis_market, "watch", watch)
    monkeypatch.setattr(
        trading.kis_market, "quote", lambda symbol, market, exchange: quotes.get(symbol)
    )
    session = ReadOnlySession(positions)
    request = Request({"type": "http", "headers": []})
    body = await trading.portfolio(request, owner, session)
    assert not session.rows
    assert len(watched) == len(positions)
    assert len(snapshots) == 1
    return body, snapshots[0]


def position(symbol="AAPL", exchange="NAS", quantity="2", average="10"):
    return SimpleNamespace(
        symbol=symbol,
        exchange=exchange,
        quantity=Decimal(quantity),
        average_price=Decimal(average),
    )


@pytest.mark.asyncio
async def test_cached_quote_is_labeled_without_refreshing_or_changing_math(monkeypatch):
    # Even an old cached quote retains its real timestamp, not the account read time.
    timestamp = "2024-01-02T03:04:05+00:00"
    body, snapshot = await isolated_portfolio(
        monkeypatch,
        [position()],
        {"AAPL": {"price": "12.5", "asOf": timestamp}},
    )
    row = body["positions"][0]
    assert row["valuationBasis"] == "QUOTE" and row["quoteAsOf"] == timestamp
    assert body["estimatedPositions"] == 0
    assert (row["currentPrice"], row["costBasis"], row["marketValue"]) == (12.5, 20, 25)
    assert (row["profit"], row["returnRate"]) == (5, 25)
    assert snapshot == (Decimal("1000"), Decimal("125"))


@pytest.mark.asyncio
@pytest.mark.parametrize("quote", [None, {}])
async def test_cost_fallback_is_explicit_and_preserves_existing_numbers(monkeypatch, quote):
    body, snapshot = await isolated_portfolio(
        monkeypatch, [position()], {"AAPL": quote}
    )
    row = body["positions"][0]
    assert row["valuationBasis"] == "COST" and row["quoteAsOf"] is None
    assert body["estimatedPositions"] == 1
    assert (row["currentPrice"], row["costBasis"], row["marketValue"]) == (10, 20, 20)
    assert (row["profit"], row["returnRate"]) == (0, 0)
    assert snapshot == (Decimal("1000"), Decimal("120"))


@pytest.mark.asyncio
async def test_mixed_currencies_count_only_cost_fallbacks(monkeypatch):
    body, snapshot = await isolated_portfolio(
        monkeypatch,
        [position("005930", "KRX", "3", "20"), position()],
        {"005930": {"price": "15"}},
    )
    assert body["estimatedPositions"] == 1
    quoted, cost = body["positions"]
    assert quoted["valuationBasis"] == "QUOTE" and quoted["quoteAsOf"] is None
    assert (quoted["profit"], quoted["returnRate"]) == (-15, -25)
    assert cost["valuationBasis"] == "COST"
    assert snapshot == (Decimal("1045"), Decimal("120"))


@pytest.mark.asyncio
async def test_guest_response_requires_no_account_or_session():
    body = await trading.portfolio(Request({"type": "http", "headers": []}), None, None)
    assert body["authenticated"] is False
    assert body["positions"] == [] and body["estimatedPositions"] == 0
