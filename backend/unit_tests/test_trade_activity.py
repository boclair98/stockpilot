"""Isolated calendar reads; no production DB, orders or external market requests."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from app.core.identity import encode_signed
from app.models import PracticeRound, PracticeState
from app.routes.trade_activity import activity_query, month_bounds, router
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects import postgresql
from unit_tests.test_order_history import add, cookie
from unit_tests.test_order_history import fixture as history_fixture


@pytest.fixture
def fixture(monkeypatch):
    yield from history_fixture.__wrapped__(monkeypatch)


@pytest.mark.asyncio
async def test_calendar_auth_own_only_bounded_month_and_currency(fixture):
    app, sync, session = fixture
    app.include_router(router)
    owner = uuid4()
    add(sync, owner, created_at=datetime(2024, 9, 30, 14, 59, 59, tzinfo=UTC))
    add(sync, owner, created_at=datetime(2024, 9, 30, 15, tzinfo=UTC))
    add(
        sync,
        owner,
        symbol="AAPL",
        exchange="NAS",
        side="SELL",
        quantity=Decimal("1.25"),
        fill_price=Decimal("123.4567"),
        fee=Decimal("0.25"),
        tax=Decimal("0"),
        realized_pnl=Decimal("-12.5"),
        created_at=datetime(2024, 9, 28, tzinfo=UTC),
        processed_at=datetime(2024, 10, 1, 14, 59, 59, tzinfo=UTC),
    )
    add(sync, owner, created_at=datetime(2024, 10, 31, 15, tzinfo=UTC))
    add(sync, owner, status="OPEN", fill_price=None)
    add(sync, uuid4())
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test"
    ) as client:
        assert (
            await client.get("/api/trading/activity?month=2024-10")
        ).status_code == 401
        client.cookies.update(cookie(owner))
        response = await client.get("/api/trading/activity?month=2024-10")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    data = response.json()
    assert data["basis"] == "execution" and data["timezone"] == "Asia/Seoul"
    assert len(data["days"]) == 1 and data["days"][0]["date"] == "2024-10-01"
    kr, us = data["totals"]
    assert kr["currency"] == "KRW" and kr["count"] == 1 and kr["buyAmount"] == 147000
    assert us["currency"] == "USD" and us["sellAmount"] == pytest.approx(154.320875)
    assert us["realizedPnl"] == -12.5 and us["buyAmount"] == 0
    assert data["legacyDateCount"] == 1 and data["unknownCurrencyCount"] == 0
    assert len(session.statements) == 1


@pytest.mark.asyncio
async def test_missing_figures_do_not_become_zero_and_unknown_currency_not_assigned(
    fixture,
):
    app, sync, _ = fixture
    app.include_router(router)
    owner = uuid4()
    add(sync, owner, side="SELL", fill_price=None, realized_pnl=None)
    add(sync, owner, side="SELL", realized_pnl=Decimal("15"))
    add(sync, owner, exchange="LEGACY")
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        data = (await client.get("/api/trading/activity?month=2024-10")).json()
        empty = (await client.get("/api/trading/activity?month=2024-11")).json()
    assert data["totals"][0]["sellAmount"] is None
    assert data["totals"][0]["realizedPnl"] is None
    assert data["totals"][0]["count"] == 2
    assert data["unknownCurrencyCount"] == 1
    assert empty["days"] == [] and all(row["count"] == 0 for row in empty["totals"])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "month",
    [
        "2024-00",
        "2024-13",
        "2024-1",
        "202410",
        "2024-10-01",
        "9999-12",
        "1899-12",
        "2101-01",
        "bad",
    ],
)
async def test_invalid_months_do_not_query_db(fixture, month):
    app, _, session = fixture
    app.include_router(router)
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(uuid4())
    ) as client:
        assert (
            await client.get("/api/trading/activity", params={"month": month})
        ).status_code == 422
    assert not session.statements


@pytest.mark.asyncio
async def test_execution_date_filter_returns_only_same_day_fills_and_cursor_binds_basis(
    fixture,
):
    app, sync, _ = fixture
    owner = uuid4()
    row = add(
        sync,
        owner,
        created_at=datetime(2024, 9, 28, tzinfo=UTC),
        processed_at=datetime(2024, 10, 1, 3, tzinfo=UTC),
    )
    add(
        sync,
        owner,
        created_at=datetime(2024, 10, 1, 3, tzinfo=UTC),
        status="OPEN",
        fill_price=None,
    )
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        data = (
            await client.get(
                "/api/trading/orders/history",
                params={
                    "from": "2024-10-01",
                    "to": "2024-10-01",
                    "dateBasis": "execution",
                },
            )
        ).json()
        assert [item["id"] for item in data["items"]] == [str(row.id)]
        assert data["items"][0]["executionAt"] == "2024-10-01T03:00:00+00:00"
        assert (
            await client.get(
                "/api/trading/orders/history",
                params={"dateBasis": "execution", "status": "OPEN"},
            )
        ).status_code == 422
        page = (
            await client.get("/api/trading/orders/history", params={"limit": 1})
        ).json()
        assert (
            await client.get(
                "/api/trading/orders/history",
                params={"cursor": page["nextCursor"], "dateBasis": "execution"},
            )
        ).status_code == 422


def test_postgres_query_aggregates_in_database_and_has_one_month_range():
    start, end = month_bounds("2024-02")
    assert (end - start).days == 29
    statement = activity_query(uuid4(), start, end, datetime.now(UTC), "postgresql")
    compiled = str(statement.compile(dialect=postgresql.dialect()))
    assert "GROUP BY" in compiled and "timezone(" in compiled and "LIMIT" in compiled
    assert "trade_orders.owner_id =" in compiled and "trade_orders.status =" in compiled
    assert "coalesce(trade_orders.processed_at, trade_orders.created_at)" in compiled


@pytest.mark.asyncio
async def test_selected_ledger_is_used_without_accepting_caller_owner(fixture):
    app, sync, _ = fixture
    app.include_router(router)
    owner, ledger, round_id = uuid4(), uuid4(), uuid4()
    sync.add(PracticeRound(id=round_id, owner_id=owner, ledger_owner_id=ledger))
    sync.add(
        PracticeState(
            owner_id=owner, active_round_id=round_id, selected_scope="practice"
        )
    )
    sync.commit()
    add(sync, owner, side="BUY")
    add(sync, ledger, side="SELL", realized_pnl=Decimal("0"))
    token = encode_signed({"id": str(owner)}, "toss-access")
    async with AsyncClient(
        transport=ASGITransport(app),
        base_url="http://test",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Stockpilot-Practice": "selected",
        },
    ) as client:
        response = await client.get("/api/trading/activity?month=2024-10")
    assert response.status_code == 200
    assert response.json()["totals"][0]["buyCount"] == 0
    assert response.json()["totals"][0]["sellCount"] == 1
