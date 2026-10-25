"""Isolated persistence regressions; no live accounts or broker requests."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
import sqlalchemy as sa
from app.models import Position, TradeOrder, TradingAccount
from app.personal_models import MoneyEvent
from app.routes import personal, trading
from app.services.statement_totals import holding_totals
from fastapi import Response

from tests import test_personal_tools as fixtures

api, store, wallet = fixtures.api, fixtures.store, fixtures.wallet

pytestmark = pytest.mark.no_db


async def test_statement_totals_use_all_orders_not_display_window(store, monkeypatch):
    owner, other = wallet(store), wallet(store)
    when = datetime(2025, 1, 1, tzinfo=UTC)
    for index in range(125):
        store.add(
            TradeOrder(
                owner_id=owner,
                symbol="005930",
                exchange="KRX",
                side="SELL",
                order_type="MARKET",
                quantity=1,
                status="FILLED",
                fill_price=100,
                realized_pnl=Decimal("12.5"),
                fee=Decimal("1.5"),
                tax=Decimal("2.5"),
                created_at=when + timedelta(minutes=index),
            )
        )
    for exchange, status in [("NAS", "FILLED"), ("NYS", "OPEN"), ("AMS", "TRIGGERED")]:
        store.add(
            TradeOrder(
                owner_id=owner,
                symbol="DELISTED",
                exchange=exchange,
                side="BUY",
                order_type="LIMIT",
                quantity=1,
                status=status,
                fill_price=10 if status == "FILLED" else None,
                realized_pnl=Decimal("7.25") if status == "FILLED" else None,
                fee=Decimal("0.25") if status == "FILLED" else 0,
                tax=0,
                created_at=when - timedelta(days=1),
            )
        )
    store.add(
        TradeOrder(
            owner_id=other,
            symbol="005930",
            exchange="KRX",
            side="SELL",
            order_type="MARKET",
            quantity=1,
            status="FILLED",
            fill_price=100,
            realized_pnl=999999,
            fee=999999,
            tax=0,
        )
    )
    await store.flush()

    async def no_processing(*args):
        pass

    async def forbidden(*args, **kwargs):
        raise AssertionError("A statement must not fetch instrument/quote per row")

    monkeypatch.setattr(trading, "process_open_orders", no_processing)
    monkeypatch.setattr(trading.instrument_catalog, "get", forbidden)
    monkeypatch.setattr(trading.kis_market, "watch", forbidden)
    response = Response()
    body = await trading.account_statement(response, owner, store)
    assert response.headers["cache-control"] == "private, no-store"
    assert len(body["orders"]) == 100
    assert body["ordersCount"] == 128 and body["ordersHasMore"] is True
    assert body["summary"]["filledOrders"] == 126
    assert body["summary"]["openOrders"] == 2
    assert body["summary"]["realizedPnl"] == {"KRW": 1562.5, "USD": 7.25}
    assert body["summary"]["costs"] == {"KRW": 500, "USD": 0.25}
    assert body["cash"] == {"KRW": 100000000, "USD": 100000}


async def test_all_holdings_valued_in_batches_and_display_bounded(store, monkeypatch):
    owner, other = wallet(store), wallet(store)
    for index in range(101):
        store.add(
            Position(
                owner_id=owner,
                symbol=f"{index:06}",
                exchange="KRX",
                quantity=2,
                average_price=10,
            )
        )
    for exchange in ["NAS", "NYS"]:
        store.add(
            Position(
                owner_id=owner,
                symbol="SAME",
                exchange=exchange,
                quantity=2,
                average_price=10,
            )
        )
    store.add(
        Position(
            owner_id=other,
            symbol="OTHERS",
            exchange="NAS",
            quantity=1000,
            average_price=1,
        )
    )
    store.add(
        Position(
            owner_id=owner, symbol="ZERO", exchange="NAS", quantity=0, average_price=1
        )
    )
    await store.flush()
    seen = []
    original_execute = store.execute

    async def bounded(query):
        if "positions" in str(query):
            assert query._limit_clause.value == 100
        return await original_execute(query)

    def cached_quote(symbol, market, exchange):
        seen.append((symbol, market, exchange))
        return {"price": 12}

    monkeypatch.setattr(store, "execute", bounded)
    monkeypatch.setattr(trading.kis_market, "quote", cached_quote)
    values, profits, display, count, estimated = await holding_totals(store, owner)
    assert count == 103 and len(display) == 100 and len(seen) == 103
    assert len(set(seen)) == 103
    assert values == {"KRW": Decimal(2424), "USD": Decimal(48)}
    assert profits == {"KRW": Decimal(404), "USD": Decimal(8)}
    assert estimated == 0


@pytest.mark.parametrize(
    "quote",
    [None, {}, {"price": "NaN"}, {"price": 0}, {"price": -10}, {"price": "Infinity"}],
)
async def test_missing_or_invalid_quote_is_explicit_cost_estimate(
    store, monkeypatch, quote
):
    owner = wallet(store)
    store.add(
        Position(
            owner_id=owner, symbol="AAPL", exchange="NAS", quantity=2, average_price=10
        )
    )
    await store.flush()
    monkeypatch.setattr(trading.kis_market, "quote", lambda *_: quote)
    values, profits, display, count, estimated = await holding_totals(store, owner)
    assert values["USD"] == 20 and profits["USD"] == 0
    assert count == estimated == 1
    assert display[0]["valuationBasis"] == "COST"


async def test_fx_quote_replay_survives_provider_failure_and_stays_owner_scoped(
    api, store, monkeypatch
):
    owner, other = wallet(store), wallet(store)
    payload = {
        "requestKey": "fx-recovery-test-001",
        "direction": "KRW_TO_USD",
        "amount": "140000",
    }

    async def rate():
        return {"rate": "1400", "date": "2026-10-25", "source": "isolated fixture"}

    async def offline():
        raise RuntimeError("isolated provider failure")

    monkeypatch.setattr(personal, "reference_fx", rate)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        headers = {"X-Test-Owner": str(owner)}
        first = await client.post(
            "/api/personal/fx/quote", json=payload, headers=headers
        )
        assert first.status_code == 200
        monkeypatch.setattr(personal, "reference_fx", offline)
        replay = await client.post(
            "/api/personal/fx/quote", json=payload, headers=headers
        )
        assert replay.status_code == 200 and replay.json() == first.json()
        conflict = await client.post(
            "/api/personal/fx/quote",
            json={**payload, "amount": "280000"},
            headers=headers,
        )
        assert conflict.status_code == 409
        unrelated = await client.post(
            "/api/personal/fx/quote", json=payload, headers={"X-Test-Owner": str(other)}
        )
        assert unrelated.status_code == 503
    assert await store.scalar(sa.select(sa.func.count()).select_from(MoneyEvent)) == 1
    assert (await store.get(TradingAccount, owner)).cash_krw == 100000000
