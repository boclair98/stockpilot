"""Bounded alert management checks using isolated SQLite, never live accounts."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from app.routes import engagement
from httpx import ASGITransport, AsyncClient
from unit_tests.test_alert_safety import alert, cookie
from unit_tests.test_alert_safety import fixture as alert_fixture


@pytest.fixture
def fixture(monkeypatch):
    yield from alert_fixture.__wrapped__(monkeypatch)


@pytest.mark.asyncio
async def test_active_twenty_not_hidden_by_recent_history_and_counts_cover_owner(
    fixture, monkeypatch
):
    _, store, *_ = fixture
    owner, other = uuid4(), uuid4()
    active = [alert(store, owner, number) for number in range(1, 21)]
    for number in range(21, 56):
        alert(
            store,
            owner,
            number,
            status="TRIGGERED",
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
            triggered_at=datetime(2025, 1, 1, tzinfo=UTC) + timedelta(minutes=number),
        )
    unrelated = alert(store, other, 100, status="TRIGGERED")

    async def no_quote(_):
        return None

    monkeypatch.setattr(engagement, "_quote", no_quote)
    rows = await engagement._evaluate_alerts(store, owner)
    scope, unread = await engagement._alert_scope(store, owner, rows)
    assert len(rows) == 50 and set(item.id for item in active) <= {item.id for item in rows}
    assert unrelated.id not in {item.id for item in rows}
    assert sum(item.status == "TRIGGERED" for item in rows) == 30
    assert all(item.read_at is None for item in rows)
    assert scope == {
        "activeLimit": 20,
        "recentTriggeredLimit": 30,
        "activeCount": 20,
        "triggeredCount": 35,
        "activeHasMore": False,
        "triggeredHasMore": True,
    }
    assert unread == 35
    selection = [query for query in store.queries if query._limit_clause is not None]
    assert [query._limit_clause.value for query in selection] == [20, 30]


@pytest.mark.asyncio
async def test_old_created_alert_that_reaches_now_is_in_recent_reached_list(
    fixture, monkeypatch
):
    _, store, *_ = fixture
    owner = uuid4()
    newly_reached = alert(store, owner, 1, target_price=Decimal("90"))
    for number in range(2, 37):
        alert(
            store,
            owner,
            number,
            status="TRIGGERED",
            triggered_at=datetime(2025, 1, 1, tzinfo=UTC),
        )

    async def quote(_):
        return {"price": 100, "asOf": datetime.now(UTC).isoformat()}

    monkeypatch.setattr(engagement, "_quote", quote)
    rows = await engagement._evaluate_alerts(store, owner)
    assert rows[0].id == newly_reached.id
    assert newly_reached.status == "TRIGGERED" and newly_reached.read_at is None
    assert len(rows) == 30 and len({item.id for item in rows}) == 30


@pytest.mark.asyncio
async def test_explicit_mark_all_read_covers_hidden_history_but_never_other_owner(fixture):
    app, store, *_ = fixture
    owner, other = uuid4(), uuid4()
    active = alert(store, owner, 1)
    reached = [alert(store, owner, number, status="TRIGGERED") for number in range(2, 37)]
    unrelated = alert(store, other, 100, status="TRIGGERED")
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        response = await client.post("/api/features/alerts/read")
        assert response.status_code == 200 and response.json() == {"read": 35}
        store.sync.expire_all()  # Verify persisted rows, not pre-bulk-update ORM objects.
        assert all(item.read_at is not None for item in reached)
        assert active.read_at is None and unrelated.read_at is None
        assert (await client.post("/api/features/alerts/read")).json() == {"read": 0}


@pytest.mark.asyncio
async def test_out_of_policy_legacy_active_count_is_explicitly_partial(fixture, monkeypatch):
    _, store, *_ = fixture
    owner = uuid4()
    for number in range(1, 22):
        alert(store, owner, number)

    async def no_quote(_):
        return None

    monkeypatch.setattr(engagement, "_quote", no_quote)
    rows = await engagement._evaluate_alerts(store, owner)
    scope, _ = await engagement._alert_scope(store, owner, rows)
    assert len(rows) == 20 and scope["activeCount"] == 21 and scope["activeHasMore"]


def test_missing_catalog_alert_retains_identity_and_removal_key(fixture):
    _, store, *_ = fixture
    row = alert(store, uuid4(), 1, symbol="MISSING", exchange="NAS")
    body = engagement._alert_view(row, None, None)
    assert body["id"] == str(row.id) and body["symbol"] == body["name"] == "MISSING"
    assert body["market"] == "US" and body["exchange"] == "NAS" and body["currency"] == "USD"
    assert body["currentPrice"] is None
    row.exchange = "LEGACY"
    body = engagement._alert_view(row, None, None)
    assert body["currency"] is None and body["market"] is None
