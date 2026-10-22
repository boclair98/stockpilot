"""ASGI + SQLite history checks, not production concurrency/load certification."""

import base64
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from app.core.config import settings
from app.core.database import get_session
from app.core.identity import SESSION_COOKIE, encode_session, encode_signed
from app.models import PracticeRound, PracticeState, TradeOrder
from app.routes.trading import router
from app.services.instrument_catalog import instrument_catalog
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session


class ReadOnlySession:
    def __init__(self, sync):
        self.sync = sync
        self.statements = []

    async def execute(self, statement):
        assert isinstance(statement, sa.sql.Select)
        self.statements.append(statement)
        return self.sync.execute(statement)

    async def scalar(self, statement):
        assert isinstance(statement, sa.sql.Select)
        self.statements.append(statement)
        return self.sync.scalar(statement)

    def get_bind(self):
        return self.sync.get_bind()


@pytest.fixture
def fixture(monkeypatch):
    monkeypatch.setattr(settings, "auth_session_secret", "history-unit-test-secret")
    monkeypatch.setattr(settings, "dev_fake_user", "")
    monkeypatch.setattr(settings, "toss_secure_auth_required", False)

    # History must remain available when external market/catalog requests fail.
    async def never_network():
        raise AssertionError("History must not fetch a market master/quote")

    monkeypatch.setattr(instrument_catalog, "ensure_loaded", never_network)
    engine = sa.create_engine("sqlite://")
    for model in (TradeOrder, PracticeRound, PracticeState):
        model.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as sync:
        session = ReadOnlySession(sync)
        app = FastAPI()
        app.include_router(router)

        async def database():
            return session

        app.dependency_overrides[get_session] = database
        yield app, sync, session
    engine.dispose()


def cookie(owner):
    return {SESSION_COOKIE: encode_session({"id": str(owner), "provider": "google"})}


def ordered_id(value):
    # SQLite's UUID affinity would coerce all-digit hex fixtures into integers.
    return UUID(int=(0xF << 124) + value)


def add(sync, owner, identity=None, **overrides):
    values = {
        "id": identity or uuid4(),
        "owner_id": owner,
        "symbol": "005930",
        "exchange": "KRX",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": Decimal("2"),
        "fill_price": Decimal("73500"),
        "fee": Decimal("22.05"),
        "tax": Decimal("0"),
        "realized_pnl": None,
        "status": "FILLED",
        "created_at": datetime(2024, 10, 10, 0, tzinfo=UTC),
    }
    values.update(overrides)
    row = TradeOrder(**values)
    sync.add(row)
    sync.commit()
    return row


@pytest.mark.asyncio
async def test_auth_owner_isolation_no_cache_and_read_only(fixture):
    app, sync, session = fixture
    owner, other = uuid4(), uuid4()
    own = add(sync, owner)
    add(sync, other, status="OPEN", fill_price=None)
    before = [(row.id, row.status) for row in sync.scalars(sa.select(TradeOrder))]
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/trading/orders/history")).status_code == 401
        assert not session.statements
        client.cookies.update(cookie(owner))
        response = await client.get("/api/trading/orders/history")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        body = response.json()
        assert [row["id"] for row in body["items"]] == [str(own.id)]
        assert body["hasMore"] is False and body["nextCursor"] is None
        assert body["items"][0]["name"] == "삼성전자"
        assert body["items"][0]["currency"] == "KRW"
        assert body["items"][0]["grossAmount"] == 147000
        assert body["items"][0]["realizedPnl"] is None
        assert len(session.statements) == 1
    assert before == [
        (row.id, row.status) for row in sync.scalars(sa.select(TradeOrder))
    ]


@pytest.mark.asyncio
async def test_all_history_keyset_ties_and_new_inserts(fixture):
    app, sync, _ = fixture
    owner = uuid4()
    for value in range(1, 56):
        add(sync, owner, ordered_id(value))
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        first = (await client.get("/api/trading/orders/history")).json()
        assert len(first["items"]) == 20
        assert first["hasMore"] and first["nextCursor"]
        snapshot = first["asOf"]
        # An order arriving after page one cannot shift/duplicate the next page.
        add(
            sync,
            owner,
            ordered_id(999),
            created_at=datetime.fromisoformat(snapshot) + timedelta(seconds=1),
        )
        all_ids = [row["id"] for row in first["items"]]
        next_cursor = first["nextCursor"]
        while next_cursor:
            response = await client.get(
                "/api/trading/orders/history", params={"cursor": next_cursor}
            )
            assert response.status_code == 200
            page = response.json()
            assert page["asOf"] == snapshot
            all_ids.extend(row["id"] for row in page["items"])
            next_cursor = page["nextCursor"]
        assert all_ids == [str(ordered_id(value)) for value in range(55, 0, -1)]
        assert len(set(all_ids)) == 55
        maximum = (
            await client.get("/api/trading/orders/history", params={"limit": 50})
        ).json()
        assert len(maximum["items"]) == 50


@pytest.mark.asyncio
async def test_search_side_status_market_and_exact_gross(fixture):
    app, sync, _ = fixture
    owner = uuid4()
    samsung = add(sync, owner)
    us = add(
        sync,
        owner,
        symbol="AAPL",
        exchange="NAS",
        side="SELL",
        quantity=Decimal("1.25"),
        fill_price=Decimal("123.4567"),
        realized_pnl=Decimal("0"),
        fee=Decimal("0.25"),
    )
    pending = add(
        sync, owner, symbol="MSFT", exchange="NAS", status="OPEN", fill_price=None
    )
    nxt = add(sync, owner, exchange="NXT")
    unknown = add(
        sync, owner, symbol="OLDCO", exchange="NYS", status="CANCELED", fill_price=None
    )
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:

        async def rows(**query):
            response = await client.get("/api/trading/orders/history", params=query)
            assert response.status_code == 200
            return response.json()["items"]

        assert {row["id"] for row in await rows(q="삼성")} == {
            str(samsung.id),
            str(nxt.id),
        }
        assert {row["id"] for row in await rows(q="Samsung")} == {
            str(samsung.id),
            str(nxt.id),
        }
        assert len(await rows(q="005930")) == 2
        assert len(await rows(q="NAS")) == 2
        assert len(await rows(market="KR")) == 2
        assert len(await rows(market="US")) == 3
        assert await rows(q="%") == []
        assert await rows(q="_") == []
        sell = await rows(side="SELL", market="US", status="FILLED", q="apple")
        assert len(sell) == 1 and sell[0]["id"] == str(us.id)
        assert sell[0]["currency"] == "USD" and sell[0]["name"] == "Apple"
        assert sell[0]["grossAmount"] == pytest.approx(154.320875)
        assert sell[0]["realizedPnl"] == 0
        open_rows = await rows(status="OPEN")
        assert open_rows[0]["id"] == str(pending.id)
        assert open_rows[0]["grossAmount"] is None and open_rows[0]["fillPrice"] is None
        canceled = await rows(q="OLDCO")
        assert canceled[0]["id"] == str(unknown.id)
        assert canceled[0]["name"] is None and canceled[0]["grossAmount"] is None


@pytest.mark.asyncio
async def test_date_filters_include_entire_korean_calendar_day(fixture):
    app, sync, _ = fixture
    owner = uuid4()
    before = datetime(2024, 10, 9, 14, 59, 59, 999999, tzinfo=UTC)
    first = before + timedelta(microseconds=1)
    last = datetime(2024, 10, 10, 14, 59, 59, 999999, tzinfo=UTC)
    add(sync, owner, created_at=before)
    first_row = add(sync, owner, created_at=first)
    last_row = add(sync, owner, created_at=last)
    add(sync, owner, created_at=last + timedelta(microseconds=1))
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        response = await client.get(
            "/api/trading/orders/history",
            params={"from": "2024-10-10", "to": "2024-10-10"},
        )
        assert response.status_code == 200
        assert [row["id"] for row in response.json()["items"]] == [
            str(last_row.id),
            str(first_row.id),
        ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query",
    [
        {"limit": 0},
        {"limit": 51},
        {"side": "INVALID"},
        {"status": "COMPLETED"},
        {"market": "JP"},
        {"cursor": "not-valid-base64"},
        {"cursor": ""},
        {
            "cursor": base64.urlsafe_b64encode(
                json.dumps([1, "naive", "2024-01-01", "bad", "bad"]).encode()
            ).decode()
        },
        {"from": "2024-02-30"},
        {"from": "20241010"},
        {"from": "2024-10-11", "to": "2024-10-10"},
        {"to": "9999-12-31"},
        {"q": "x" * 101},
    ],
)
async def test_invalid_queries_never_hit_database(fixture, query):
    app, _, session = fixture
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(uuid4())
    ) as client:
        assert (
            await client.get("/api/trading/orders/history", params=query)
        ).status_code == 422
    assert not session.statements


@pytest.mark.asyncio
async def test_cursor_is_bound_to_owner_and_filter(fixture):
    app, sync, _ = fixture
    owner = uuid4()
    add(sync, owner)
    add(sync, owner)
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        page = (
            await client.get("/api/trading/orders/history", params={"limit": 1})
        ).json()
        cursor = page["nextCursor"]
        assert (
            await client.get(
                "/api/trading/orders/history", params={"cursor": cursor, "market": "US"}
            )
        ).status_code == 422
        client.cookies.clear()
        client.cookies.update(cookie(uuid4()))
        assert (
            await client.get("/api/trading/orders/history", params={"cursor": cursor})
        ).status_code == 422


@pytest.mark.asyncio
async def test_selected_practice_account_is_not_original_history(fixture):
    app, sync, _ = fixture
    owner, ledger = uuid4(), uuid4()
    round_id = uuid4()
    # Same account selection dependency as portfolio; never accepts caller owner IDs.
    sync.add(
        PracticeRound(
            id=round_id,
            owner_id=owner,
            ledger_owner_id=ledger,
        )
    )
    sync.add(
        PracticeState(
            owner_id=owner, active_round_id=round_id, selected_scope="practice"
        )
    )
    sync.commit()
    add(sync, owner)
    practice = add(sync, ledger, symbol="AAPL", exchange="NAS")
    token = encode_signed({"id": str(owner)}, "toss-access")
    async with AsyncClient(
        transport=ASGITransport(app),
        base_url="http://test",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Stockpilot-Practice": "selected",
        },
    ) as client:
        response = await client.get("/api/trading/orders/history")
        assert response.status_code == 200
        assert [row["id"] for row in response.json()["items"]] == [str(practice.id)]


@pytest.mark.asyncio
async def test_unknown_legacy_exchange_does_not_invent_currency(fixture):
    app, sync, _ = fixture
    owner = uuid4()
    add(sync, owner, symbol="LEGACY", exchange="UNKNOWN")
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        row = (await client.get("/api/trading/orders/history")).json()["items"][0]
        assert row["market"] is None and row["currency"] is None and row["name"] is None
        domestic = await client.get(
            "/api/trading/orders/history", params={"market": "KR"}
        )
        overseas = await client.get(
            "/api/trading/orders/history", params={"market": "US"}
        )
        assert domestic.json()["items"] == overseas.json()["items"] == []


@pytest.mark.asyncio
async def test_broad_name_search_does_not_exceed_postgres_bind_limit(
    fixture, monkeypatch
):
    app, _, _ = fixture
    owner = uuid4()
    monkeypatch.setattr(
        instrument_catalog,
        "matching_names_cached",
        lambda *_: [("NAS", f"FIXTURE{number}") for number in range(40000)],
    )

    class PostgresReadOnly:
        def get_bind(self):
            return SimpleNamespace(dialect=postgresql.dialect())

        async def execute(self, statement):
            compiled = statement.compile(dialect=postgresql.dialect())
            assert "ANY" in str(compiled)
            assert len(compiled.params) < 20
            assert owner in compiled.params.values()
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))

    async def database():
        return PostgresReadOnly()

    app.dependency_overrides[get_session] = database
    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test", cookies=cookie(owner)
    ) as client:
        response = await client.get("/api/trading/orders/history", params={"q": "a"})
        assert response.status_code == 200 and response.json()["items"] == []
