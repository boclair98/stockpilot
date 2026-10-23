"""SQLite/ASGI alert and scheduler regression checks; no real push/API calls."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from app.core.config import settings
from app.core.database import get_session
from app.core.identity import SESSION_COOKIE, encode_session
from app.models import PriceAlert, PushDevice, TradingAccount
from app.routes import engagement, personal
from app.services import firebase_push as push_adapter
from app.services import price_alert_notifier as notifications
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market
from app.services.price_alerts import current_alert_price
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.orm import Session


class LocalSession:
    def __init__(self, sync):
        self.sync = sync
        self.queries = []

    async def execute(self, query):
        self.queries.append(query)
        return self.sync.execute(query)

    async def scalar(self, query):
        self.queries.append(query)
        return self.sync.scalar(query)

    async def get(self, model, key):
        return self.sync.get(model, key)

    def add(self, row):
        self.sync.add(row)

    async def flush(self):
        self.sync.flush()

    async def delete(self, row):
        self.sync.delete(row)


class LocalFactory:
    def __init__(self, store):
        self.store = store

    @asynccontextmanager
    async def __call__(self):
        yield self.store

    @asynccontextmanager
    async def begin(self):
        with self.store.sync.begin_nested():
            yield self.store


class MemoryCursor:
    def __init__(self):
        self.data = {}

    async def get_json(self, key):
        return self.data.get(key)

    async def set_json(self, key, value, ttl):
        self.data[key] = value


@pytest.fixture
def fixture(monkeypatch):
    monkeypatch.setattr(settings, "auth_session_secret", "alert-regression-only")
    monkeypatch.setattr(settings, "dev_fake_user", "")
    engine = sa.create_engine("sqlite://")
    for model in (PriceAlert, PushDevice, TradingAccount):
        model.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as sync:
        store = LocalSession(sync)
        app = FastAPI()
        app.include_router(engagement.router)
        app.include_router(personal.router)

        async def database():
            with sync.begin_nested():
                yield store

        async def lookup(symbol, market=None, exchange=None):
            return instrument_catalog.get_cached(symbol, market, exchange)

        async def watch(_):
            return None

        async def quote(_):
            return {"price": 100, "asOf": datetime.now(UTC).isoformat()}

        sends = []

        async def push(tokens, **payload):
            sends.append((tokens, payload))
            return SimpleNamespace(success_count=1, invalid_tokens=())

        push_adapter = SimpleNamespace(configured=False, send=push)
        cursor = MemoryCursor()
        app.dependency_overrides[get_session] = database
        monkeypatch.setattr(instrument_catalog, "get", lookup)
        monkeypatch.setattr(kis_market, "watch", watch)
        monkeypatch.setattr(kis_market, "fetch_quote", quote)
        monkeypatch.setattr(notifications, "AsyncSessionLocal", LocalFactory(store))
        monkeypatch.setattr(notifications, "traffic_store", cursor)
        monkeypatch.setattr(notifications, "firebase_push", push_adapter)
        yield app, store, cursor, push_adapter, sends
    engine.dispose()


def cookie(owner):
    return {SESSION_COOKIE: encode_session({"id": str(owner), "provider": "google"})}


def wallet(store, owner=None):
    owner = owner or uuid4()
    store.add(TradingAccount(owner_id=owner, cash_krw=100000000, cash=100000))
    store.sync.flush()
    return owner


def alert(store, owner, number, **extra):
    data = dict(
        id=UUID(int=(0xF << 124) + number),
        owner_id=owner,
        symbol="005930",
        exchange="KRX",
        direction="ABOVE",
        target_price=Decimal("200"),
        status="ACTIVE",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    data.update(extra)
    row = PriceAlert(**data)
    store.add(row)
    store.sync.flush()
    return row


@pytest.mark.asyncio
async def test_later_alerts_checked_after_first_fifty_unmet_and_wrap(fixture):
    _, store, cursor, _, sends = fixture
    owner = uuid4()
    for n in range(1, 56):
        alert(store, owner, n)
    later = alert(store, owner, 56, target_price=Decimal("90"))
    notifier = notifications.PriceAlertNotifier()
    assert await notifier.poll_once() == 0
    assert later.status == "ACTIVE"
    assert await notifier.poll_once() == 0
    assert later.status == "TRIGGERED" and later.triggered_at is not None
    assert later.notified_at is None and sends == []
    end_cursor = cursor.data[notifications.CURSOR_KEY]
    await notifier.poll_once()
    assert cursor.data[notifications.CURSOR_KEY] != end_cursor
    assert (
        str(UUID(int=(0xF << 124) + 50)) == cursor.data[notifications.CURSOR_KEY]["id"]
    )


@pytest.mark.asyncio
async def test_no_device_triggered_alerts_do_not_block_new_or_send(fixture):
    _, store, _, adapter, sends = fixture
    adapter.configured = True
    owner = uuid4()
    for n in range(1, 56):
        alert(store, owner, n, status="TRIGGERED", triggered_at=datetime.now(UTC))
    later = alert(store, owner, 56, target_price=Decimal("90"))
    assert await notifications.PriceAlertNotifier().poll_once() == 0
    assert later.status == "TRIGGERED" and sends == []


@pytest.mark.asyncio
async def test_one_failed_symbol_does_not_block_later_alerts(fixture, monkeypatch):
    _, store, _, _, _ = fixture
    owner = uuid4()
    failed = alert(store, owner, 1, symbol="MISSING", target_price=Decimal("90"))
    good = alert(store, owner, 2, target_price=Decimal("90"))

    async def lookup(symbol, market=None, exchange=None):
        if symbol == "MISSING":
            raise ValueError("isolated provider failure")
        return instrument_catalog.get_cached(symbol, market, exchange)

    monkeypatch.setattr(instrument_catalog, "get", lookup)
    await notifications.PriceAlertNotifier().poll_once()
    assert failed.status == "ACTIVE" and good.status == "TRIGGERED"


@pytest.mark.asyncio
async def test_push_delivery_only_after_eligible_quote_and_not_again(fixture):
    _, store, _, adapter, sends = fixture
    adapter.configured = True
    owner = uuid4()
    row = alert(store, owner, 1, target_price=Decimal("90"))
    store.add(PushDevice(owner_id=owner, token="isolated-test-token", enabled=True))
    store.sync.flush()
    notifier = notifications.PriceAlertNotifier()
    assert await notifier.poll_once() == 1
    assert row.notified_at is not None
    assert sends[0][1]["data"]["alertId"] == str(row.id)
    assert await notifier.poll_once() == 0
    assert len(sends) == 1


@pytest.mark.asyncio
async def test_background_starts_without_firebase(fixture, monkeypatch):
    notifier = notifications.PriceAlertNotifier()
    started = asyncio.Event()

    async def run():
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(notifier, "_run", run)
    notifier.start()
    try:
        await asyncio.wait_for(started.wait(), timeout=1)
        assert notifier._task is not None
    finally:
        await notifier.stop()


@pytest.mark.asyncio
async def test_invalid_quote_never_triggers_dashboard_or_background(
    fixture, monkeypatch
):
    _, store, _, _, _ = fixture
    owner = uuid4()
    row = alert(store, owner, 1, target_price=Decimal("90"))
    stale = {"price": 100, "asOf": (datetime.now(UTC) - timedelta(hours=1)).isoformat()}

    async def quote(_):
        return stale

    monkeypatch.setattr(kis_market, "fetch_quote", quote)
    monkeypatch.setattr(engagement, "_quote", quote)
    await notifications.PriceAlertNotifier().poll_once()
    await engagement._evaluate_alerts(store, owner)
    assert row.status == "ACTIVE" and row.triggered_at is None


@pytest.mark.parametrize(
    "quote",
    [
        None,
        {},
        {"price": "NaN", "asOf": "2024-01-01T00:00:00Z"},
        {"price": "Infinity", "asOf": "2024-01-01T00:00:00Z"},
        {"price": 0, "asOf": "2024-01-01T00:00:00Z"},
        {"price": -1, "asOf": "2024-01-01T00:00:00Z"},
        {"price": 100, "asOf": "2024-01-01T00:00:00"},
        {"price": 100, "asOf": "2024-01-01T00:03:00Z"},
    ],
)
def test_malformed_quotes_fail_closed(quote):
    assert current_alert_price(quote, datetime(2024, 1, 1, tzinfo=UTC)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "value", ["0", "-1", "1e99", "0.000001", "100.00001", "NaN", "Infinity"]
)
async def test_target_price_returns_422_instead_of_db_rounding_or_overflow(
    fixture, value
):
    app, store, *_ = fixture
    owner = wallet(store)
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        response = await client.post(
            "/api/features/alerts",
            json={
                "symbol": "005930",
                "market": "KR",
                "exchange": "KRX",
                "direction": "ABOVE",
                "targetPrice": value,
            },
        )
        assert response.status_code == 422
    assert store.sync.scalar(sa.select(sa.func.count()).select_from(PriceAlert)) == 0


@pytest.mark.asyncio
async def test_creation_dedup_limit_owner_scope_and_exact_value(fixture):
    app, store, *_ = fixture
    owner, other = wallet(store), wallet(store)
    body = {
        "symbol": "AAPL",
        "market": "US",
        "exchange": "NAS",
        "direction": "ABOVE",
        "targetPrice": "123.4567",
    }
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        first = await client.post("/api/features/alerts", json=body)
        assert first.status_code == 201
        second = await client.post("/api/features/alerts", json=body)
        assert first.json()["id"] == second.json()["id"]
        row = store.sync.get(PriceAlert, UUID(first.json()["id"]))
        assert row.target_price == Decimal("123.4567")
        # Serialization lock must precede count/insert (SQLite doesn't prove PG concurrency).
        assert any(
            getattr(query, "_for_update_arg", None) is not None
            for query in store.queries
        )
        for number in range(1, 20):
            alert(store, owner, number)
        duplicate = await client.post("/api/features/alerts", json=body)
        assert (
            duplicate.status_code == 201
            and duplicate.json()["id"] == first.json()["id"]
        )
        assert (
            await client.post(
                "/api/features/alerts", json={**body, "targetPrice": "124"}
            )
        ).status_code == 409
        client.cookies.clear()
        client.cookies.update(cookie(other))
        assert (
            await client.delete(f"/api/features/alerts/{row.id}")
        ).status_code == 404
        assert (await client.post("/api/features/alerts", json=body)).json()[
            "id"
        ] != str(row.id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "local_time", ["09:99", "09:60", "24:00", "9:30", "12:90", "０９:３０"]
)
async def test_bad_recurring_time_is_validation_error(fixture, local_time):
    app, store, *_ = fixture
    owner = wallet(store)
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        response = await client.post(
            "/api/personal/recurring",
            json={
                "requestKey": "fixture-request-key",
                "symbol": "005930",
                "market": "KR",
                "exchange": "KRX",
                "amount": "10000",
                "weekday": 0,
                "localTime": local_time,
            },
        )
        assert response.status_code == 422
    assert not store.queries


@pytest.mark.asyncio
async def test_push_adapter_uses_async_transport_and_preserves_result(monkeypatch):
    adapter = push_adapter.FirebasePush()
    app = object()
    monkeypatch.setattr(adapter, "_initialize", lambda: app)

    async def send(message, dry_run, selected_app):
        assert message.tokens == ["fixture-good", "fixture-invalid"]
        assert message.data["alertId"] == "fixture-alert"
        assert message.data["title"] == "목표가 도달"
        assert selected_app is app and dry_run is False
        return SimpleNamespace(
            success_count=1,
            responses=[
                SimpleNamespace(success=True, exception=None),
                SimpleNamespace(
                    success=False,
                    exception=ValueError("registration-token-not-registered"),
                ),
            ],
        )

    monkeypatch.setattr(push_adapter.messaging, "send_each_for_multicast_async", send)
    result = await adapter.send(
        ["fixture-good", "fixture-invalid"],
        title="목표가 도달",
        body="가격 확인",
        data={"alertId": "fixture-alert"},
    )
    assert result.success_count == 1
    assert result.invalid_tokens == ("fixture-invalid",)


@pytest.mark.asyncio
async def test_push_timeout_cancels_transport_without_marking_delivery(monkeypatch):
    adapter = push_adapter.FirebasePush()
    monkeypatch.setattr(adapter, "_initialize", object)
    monkeypatch.setattr(push_adapter, "PUSH_SEND_TIMEOUT_SECONDS", 0.01)
    canceled = asyncio.Event()

    async def send(*_):
        try:
            await asyncio.Event().wait()
        finally:
            canceled.set()

    monkeypatch.setattr(push_adapter.messaging, "send_each_for_multicast_async", send)
    result = await adapter.send(
        ["fixture-device"], title="목표가", body="가격 확인", data={}
    )
    assert canceled.is_set()
    assert result.success_count == 0 and result.invalid_tokens == ()


@pytest.mark.asyncio
async def test_notifier_cancellation_reaches_push_transport(monkeypatch):
    adapter = push_adapter.FirebasePush()
    monkeypatch.setattr(adapter, "_initialize", object)
    started = asyncio.Event()
    canceled = asyncio.Event()

    async def send(*_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            canceled.set()

    monkeypatch.setattr(push_adapter.messaging, "send_each_for_multicast_async", send)
    task = asyncio.create_task(
        adapter.send(["fixture-device"], title="목표가", body="가격 확인", data={})
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert canceled.is_set()
