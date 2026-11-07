"""Actual report response checks with all database and external boundaries stubbed."""

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from app.routes import engagement


def position(symbol="AAPL", exchange="NAS", quantity="2", average="10"):
    return SimpleNamespace(
        symbol=symbol,
        exchange=exchange,
        quantity=Decimal(quantity),
        average_price=Decimal(average),
    )


async def isolated_dashboard(monkeypatch, positions, quotes, missing=()):
    owner = uuid4()
    snapshots, performance_inputs = [], []
    wallet = SimpleNamespace(cash_krw=Decimal("1000"), cash=Decimal("100"))
    orders = [
        SimpleNamespace(
            status="FILLED", symbol="AAPL", exchange="NAS", order_type="LIMIT",
            fee=Decimal("0.25"), tax=Decimal("0.10"), realized_pnl=Decimal("3.50"),
        )
    ]

    class ReadOnlySession:
        def __init__(self):
            self.rows = [[], positions, orders, []]

        async def get(self, model, actual_owner):
            assert model is engagement.TradingAccount and actual_owner == owner
            return wallet

        async def execute(self, statement):
            assert isinstance(statement, sa.sql.Select)
            rows = self.rows.pop(0)
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))

        async def scalar(self, statement):
            assert isinstance(statement, sa.sql.Select)
            return 0

    async def instrument(symbol, exchange):
        if symbol in missing:
            return None
        krw = exchange == "KRX"
        return SimpleNamespace(
            symbol=symbol, exchange=exchange, name=symbol,
            market="KR" if krw else "US", currency="KRW" if krw else "USD",
        )

    async def quote(item):
        return quotes.get(item.symbol)

    async def no_alert_evaluation(*args):
        return []

    async def alert_scope(*args):
        return {}, 0

    async def performance(session, actual_owner, krw, usd):
        assert actual_owner == owner
        performance_inputs.append((krw, usd))
        return krw, usd

    async def snapshot(session, actual_owner, krw, usd):
        assert actual_owner == owner
        snapshots.append((krw, usd))

    monkeypatch.setattr(engagement.instrument_catalog, "get", instrument)
    monkeypatch.setattr(engagement, "_quote", quote)
    monkeypatch.setattr(engagement, "_evaluate_alerts", no_alert_evaluation)
    monkeypatch.setattr(engagement, "_alert_scope", alert_scope)
    monkeypatch.setattr(engagement, "performance_equity", performance)
    monkeypatch.setattr(engagement, "record_daily_snapshot", snapshot)
    session = ReadOnlySession()
    body = await engagement.dashboard(owner, session)
    assert not session.rows
    assert len(snapshots) == len(performance_inputs) == 1
    assert snapshots == performance_inputs
    return body["report"], snapshots[0]


@pytest.mark.asyncio
async def test_report_quotes_are_complete_and_existing_financial_numbers_unchanged(monkeypatch):
    report, snapshot = await isolated_dashboard(
        monkeypatch,
        [position("005930", "KRX", "3", "20"), position()],
        {"005930": {"price": "15"}, "AAPL": {"price": "12.5"}},
    )
    assert report["valuationComplete"] is True
    assert report["estimatedPositions"] == report["unavailablePositions"] == 0
    assert all(row["valuationBasis"] == "QUOTE" for row in report["allocations"])
    assert [row["value"] for row in report["allocations"]] == [45, 25]
    assert report["equity"] == {"KRW": 1045, "USD": 125}
    assert snapshot == (Decimal("1045"), Decimal("125"))
    assert report["returnRate"]["KRW"] == float(engagement.return_rate(snapshot[0], engagement.INITIAL_KRW))
    assert report["returnRate"]["USD"] == float(engagement.return_rate(snapshot[1], engagement.INITIAL_USD))
    assert report["returnRate"]["combined"] == float(engagement.combined_return_rate(*snapshot))
    assert report["tradeCount"] == 1 and report["winRate"] == 100
    assert report["realizedPnl"] == {"KRW": 0, "USD": 3.5}
    assert report["totalCosts"] == {"KRW": 0, "USD": 0.35}


@pytest.mark.asyncio
@pytest.mark.parametrize("quote", [None, {}, {"price": None}])
async def test_missing_quote_marks_cost_without_changing_fallback_snapshot_or_filled_stats(monkeypatch, quote):
    report, snapshot = await isolated_dashboard(monkeypatch, [position()], {"AAPL": quote})
    assert report["valuationComplete"] is False
    assert report["estimatedPositions"] == 1 and report["unavailablePositions"] == 0
    assert report["allocations"] == [{
        "symbol": "AAPL", "name": "AAPL", "market": "US", "currency": "USD",
        "value": 20, "valuationBasis": "COST",
    }]
    assert report["equity"] == {"KRW": 1000, "USD": 120}
    assert snapshot == (Decimal("1000"), Decimal("120"))
    assert report["tradeCount"] == 1 and report["realizedPnl"]["USD"] == 3.5


@pytest.mark.asyncio
async def test_missing_catalog_counts_excluded_positions_without_inventing_currency_or_value(monkeypatch):
    report, snapshot = await isolated_dashboard(
        monkeypatch, [position("MISSING", "OLD", "100", "999")], {}, missing={"MISSING"},
    )
    assert report["valuationComplete"] is False
    assert report["unavailablePositions"] == 1 and report["estimatedPositions"] == 0
    assert report["allocations"] == []
    assert report["equity"] == {"KRW": 1000, "USD": 100}
    assert snapshot == (Decimal("1000"), Decimal("100"))


@pytest.mark.asyncio
async def test_mixed_catalog_and_cost_fallbacks_preserve_separate_counts_and_existing_values(monkeypatch):
    report, snapshot = await isolated_dashboard(
        monkeypatch,
        [position("005930", "KRX", "3", "20"), position(), position("MISSING", "OLD")],
        {"005930": {"price": "15"}}, missing={"MISSING"},
    )
    assert report["valuationComplete"] is False
    assert report["estimatedPositions"] == report["unavailablePositions"] == 1
    assert [row["valuationBasis"] for row in report["allocations"]] == ["QUOTE", "COST"]
    assert [row["value"] for row in report["allocations"]] == [45, 20]
    assert snapshot == (Decimal("1045"), Decimal("120"))
