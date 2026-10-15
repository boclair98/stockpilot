"""Isolated SQLite persistence + ASGI tests. Not a Postgres concurrency test."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import pytest
import sqlalchemy as sa
from app.core.database import get_session
from app.core.identity import require_identity
from app.models import (
    AuditEvent,
    Position,
    PracticeRound,
    PriceAlert,
    ProtectionPlan,
    TradeOrder,
    TradingAccount,
    TradingControl,
    User,
    WatchlistItem,
)
from app.personal_models import (
    CorporateAction,
    InboxRead,
    MoneyEvent,
    RecurringPlan,
    RecurringRun,
    SavedItem,
    ServiceNotice,
    SupportTicket,
)
from app.routes import personal
from app.services.instrument_catalog import TOP_INSTRUMENTS, instrument_catalog
from app.services.personal_ledger import apply_action, book_fx, performance_equity
from app.services.personal_math import (
    fx_amount,
    next_weekly,
    parse_ecb,
    split_values,
    verified_source_url,
)
from app.services.personal_worker import live_regular, run_plan
from fastapi import FastAPI, Request
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

pytestmark = pytest.mark.no_db


@compiles(JSONB, "sqlite")
def jsonb_sqlite(element, compiler, **kwargs):
    return "JSON"


class LocalSession:
    def __init__(self, session):
        self.session = session

    async def execute(self, query):
        return self.session.execute(query)

    async def scalar(self, query):
        return self.session.scalar(query)

    async def scalars(self, query):
        return self.session.scalars(query)

    async def get(self, model, key, **kwargs):
        return self.session.get(model, key)

    async def flush(self):
        self.session.flush()

    def add(self, row):
        self.session.add(row)


@pytest.fixture
def store():
    engine = sa.create_engine("sqlite://")
    tables = [
        model.__table__
        for model in (
            TradingAccount,
            User,
            PracticeRound,
            TradeOrder,
            Position,
            TradingControl,
            ProtectionPlan,
            AuditEvent,
            WatchlistItem,
            PriceAlert,
            SavedItem,
            InboxRead,
            SupportTicket,
            ServiceNotice,
            MoneyEvent,
            RecurringPlan,
            RecurringRun,
            CorporateAction,
        )
    ]
    for table in tables:
        table.create(engine)
    with Session(engine) as session:
        session.add(
            TradingControl(
                scope="GLOBAL",
                halted=False,
                max_order_notional_krw=50000000,
                max_order_notional_usd=50000,
                max_open_orders=50,
                max_daily_orders=100,
            )
        )
        session.flush()
        yield LocalSession(session)
    engine.dispose()


def wallet(store, owner=None, krw=100000000, usd=100000):
    owner = owner or uuid4()
    store.add(TradingAccount(owner_id=owner, cash_krw=Decimal(krw), cash=Decimal(usd)))
    store.session.flush()
    return owner


@pytest.fixture
def api(store, monkeypatch):
    app = FastAPI()
    app.include_router(personal.router)

    async def db():
        with store.session.begin_nested():
            yield store

    async def who(request: Request):
        from fastapi import HTTPException

        if not request.headers.get("X-Test-Owner"):
            raise HTTPException(401)
        return UUID(request.headers["X-Test-Owner"])

    async def catalog(symbol, market=None, exchange=None):
        return next(
            (
                row
                for row in TOP_INSTRUMENTS
                if row.symbol == symbol
                and (not market or row.market == market)
                and (not exchange or row.exchange == exchange)
            ),
            None,
        )

    monkeypatch.setattr(instrument_catalog, "get", catalog)
    app.dependency_overrides[get_session] = db
    app.dependency_overrides[require_identity] = who
    return app


async def test_owner_saved_and_conflict(api, store):
    a, b = wallet(store), wallet(store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        url = "/api/personal/saved/NOTE/KRX:005930"
        result = await client.put(
            url,
            json={"data": {"note": "나의 판단"}, "version": 0},
            headers={"X-Test-Owner": str(a)},
        )
        assert result.status_code == 200 and result.json()["version"] == 1
        assert (
            await client.put(
                url,
                json={"data": {"note": "덮어쓰기"}, "version": 0},
                headers={"X-Test-Owner": str(a)},
            )
        ).status_code == 409
        other = await client.get(
            "/api/personal/saved?kind=NOTE", headers={"X-Test-Owner": str(b)}
        )
        assert other.json()["items"] == []
        assert result.headers["cache-control"] == "private, no-store"
        assert (await client.get("/api/personal/saved?kind=NOTE")).status_code == 401
        deleted = await client.delete(
            url + "?version=1", headers={"X-Test-Owner": str(a)}
        )
        assert deleted.json()["deleted"] is True
        assert (
            await client.put(
                url,
                json={"data": {"note": "古い"}, "version": 1},
                headers={"X-Test-Owner": str(a)},
            )
        ).status_code == 409


async def test_support_duplicate_and_private(api, store):
    a, b = wallet(store), wallet(store)
    payload = {
        "requestKey": "ticket-test-123",
        "category": "BUG",
        "subject": "버튼 문의",
        "body": "확인 버튼이 동작하지 않아요",
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        first = await client.post(
            "/api/personal/support", json=payload, headers={"X-Test-Owner": str(a)}
        )
        again = await client.post(
            "/api/personal/support", json=payload, headers={"X-Test-Owner": str(a)}
        )
        assert first.status_code == 200 and first.json()["id"] == again.json()["id"]
        assert (
            await client.get("/api/personal/support", headers={"X-Test-Owner": str(b)})
        ).json()["items"] == []
        payload["body"] = "Bearer " + "x" * 40
        assert (
            await client.post(
                "/api/personal/support", json=payload, headers={"X-Test-Owner": str(a)}
            )
        ).status_code == 422


async def test_fx_is_atomic_idempotent_and_not_profit(store):
    owner = wallet(store)
    row = MoneyEvent(
        owner_id=owner,
        kind="FX",
        request_key="fx-test-0001",
        status="QUOTED",
        data={
            "amount": "140000",
            "received": "100.00",
            "direction": "KRW_TO_USD",
            "date": "2026-10-13",
        },
        expires_at=datetime.now(UTC) + timedelta(minutes=2),
    )
    store.add(row)
    await store.flush()
    await book_fx(store, owner, row.id)
    await book_fx(store, owner, row.id)
    account = await store.get(TradingAccount, owner)
    assert account.cash_krw == Decimal(99860000) and account.cash == Decimal(100100)
    assert await performance_equity(store, owner, account.cash_krw, account.cash) == (
        Decimal(100000000),
        Decimal(100000),
    )
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as error:
        await book_fx(store, uuid4(), row.id)
    assert error.value.status_code == 404


async def test_fx_expiry_and_pending_buy(store):
    owner = wallet(store)
    row = MoneyEvent(
        owner_id=owner,
        kind="FX",
        request_key="fx-test-0002",
        status="QUOTED",
        data={
            "amount": "140000",
            "received": "100",
            "direction": "KRW_TO_USD",
            "date": "2026-10-13",
        },
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    store.add(row)
    await store.flush()
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        await book_fx(store, owner, row.id)
    row.expires_at = datetime.now(UTC) + timedelta(minutes=2)
    store.add(
        TradeOrder(
            owner_id=owner,
            symbol="005930",
            exchange="KRX",
            side="BUY",
            order_type="LIMIT",
            quantity=1,
            status="OPEN",
        )
    )
    await store.flush()
    with pytest.raises(HTTPException):
        await book_fx(store, owner, row.id)
    assert (await store.get(TradingAccount, owner)).cash_krw == Decimal(100000000)


async def test_dividend_entitlement_and_duplicate(store):
    owner = wallet(store)
    now = datetime.now(UTC)
    order = TradeOrder(
        owner_id=owner,
        symbol="005930",
        exchange="KRX",
        side="BUY",
        order_type="MARKET",
        quantity=5,
        fill_price=100,
        status="FILLED",
        created_at=now - timedelta(days=3),
        processed_at=now - timedelta(days=3),
    )
    action = CorporateAction(
        source_key="dividend-test-0001",
        symbol="005930",
        market="KR",
        exchange="KRX",
        currency="KRW",
        kind="DIVIDEND",
        per_share=Decimal(350),
        cutoff_at=now - timedelta(days=2),
        pay_at=now - timedelta(minutes=1),
        source_url="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=verified",
    )
    store.add(order)
    store.add(action)
    await store.flush()
    first = await apply_action(store, owner, action)
    again = await apply_action(store, owner, action)
    assert first.id == again.id and first.status == "APPLIED"
    assert (await store.get(TradingAccount, owner)).cash_krw == Decimal(100001750)


async def test_split_cost_basis_and_pending_block(store):
    owner = wallet(store)
    now = datetime.now(UTC)
    store.add(
        TradeOrder(
            owner_id=owner,
            symbol="AAPL",
            exchange="NAS",
            side="BUY",
            order_type="MARKET",
            quantity=4,
            fill_price=100,
            status="FILLED",
            processed_at=now - timedelta(days=2),
        )
    )
    position = Position(
        owner_id=owner, symbol="AAPL", exchange="NAS", quantity=4, average_price=100
    )
    action = CorporateAction(
        source_key="split-test-0001",
        symbol="AAPL",
        market="US",
        exchange="NAS",
        currency="USD",
        kind="SPLIT",
        ratio=Decimal(2),
        cutoff_at=now - timedelta(minutes=1),
        pay_at=now - timedelta(minutes=1),
        source_url="https://www.sec.gov/Archives/test",
    )
    store.add(position)
    store.add(action)
    await store.flush()
    result = await apply_action(store, owner, action)
    assert (
        result.status == "APPLIED"
        and position.quantity == 8
        and position.average_price == 50
    )
    await apply_action(store, owner, action)
    assert position.quantity == 8


async def test_recurring_missing_or_late_no_execution(store):
    owner = wallet(store)
    now = datetime(2026, 10, 14, 1, 0, tzinfo=UTC)
    item = next(row for row in TOP_INSTRUMENTS if row.symbol == "005930")
    plan = RecurringPlan(
        owner_id=owner,
        request_key="weekly-test-001",
        fingerprint="x" * 64,
        symbol=item.symbol,
        market="KR",
        exchange="KRX",
        name=item.name,
        currency="KRW",
        amount=1000000,
        weekday=2,
        local_time="10:00",
        timezone="Asia/Seoul",
        next_at=now,
    )
    store.add(plan)
    await store.flush()
    run = await run_plan(
        store,
        plan.id,
        item,
        {"price": 100, "marketState": "SNAPSHOT", "asOf": now.isoformat()},
        now,
    )
    assert run.status == "SKIPPED" and run.order_id is None and plan.next_at > now
    assert await run_plan(store, plan.id, item, None, now) is None
    assert (await store.get(TradingAccount, owner)).cash_krw == Decimal(100000000)


async def test_recurring_fills_one_slot(store):
    owner = wallet(store)
    now = datetime.now(UTC)
    # Derive a regular-session test instant; production never fabricates a quote.
    now = datetime(2026, 10, 14, 1, 0, tzinfo=UTC)
    item = next(row for row in TOP_INSTRUMENTS if row.symbol == "005930")
    plan = RecurringPlan(
        owner_id=owner,
        request_key="weekly-test-002",
        fingerprint="x" * 64,
        symbol=item.symbol,
        market="KR",
        exchange="KRX",
        name=item.name,
        currency="KRW",
        amount=1000000,
        weekday=2,
        local_time="10:00",
        timezone="Asia/Seoul",
        next_at=now,
    )
    store.add(plan)
    await store.flush()
    quote = {
        "price": 100000,
        "marketState": "LIVE",
        "asOf": datetime.now(UTC).isoformat(),
        "volume": 1000000,
    }
    # run_plan clock and freshness are deterministic; risk engine uses actual now.
    from unittest.mock import patch

    with patch("app.services.personal_worker.live_regular", return_value=True):
        result = await run_plan(store, plan.id, item, quote, now)
    assert result.status == "FILLED" and result.order_id is not None
    assert await run_plan(store, plan.id, item, quote, now) is None
    assert store.session.scalar(sa.select(sa.func.count()).select_from(TradeOrder)) == 1


def test_reference_rate_schedule_math():
    xml = '<Envelope><Cube><Cube time="2026-10-13"><Cube currency="USD" rate="1.1"/><Cube currency="KRW" rate="1540"/></Cube></Cube></Envelope>'
    rate = parse_ecb(xml, date(2026, 10, 14))
    assert rate["rate"] == "1400.000000"
    assert fx_amount(140001, "KRW_TO_USD", 1400) == Decimal("100.00")
    assert fx_amount("100.01", "USD_TO_KRW", 1400) == Decimal(140014)
    with pytest.raises(ValueError):
        parse_ecb(xml, date(2026, 11, 1))
    assert split_values(10, 100, 2) == (Decimal(20), Decimal(50))
    with pytest.raises(ValueError):
        split_values("0.000001", 100, "0.5")
    assert (
        next_weekly(
            datetime(2026, 10, 30, 15, 0, tzinfo=UTC), 0, "10:00", "America/New_York"
        ).hour
        == 15
    )
    assert not verified_source_url("https://sec.gov.evil.test/report")
    assert verified_source_url("https://www.sec.gov/Archives/report")
    assert not live_regular(
        {"price": 1, "marketState": "SNAPSHOT", "asOf": "2026-10-14T01:00:00Z"},
        "KR",
        datetime(2026, 10, 14, 1, 0, tzinfo=UTC),
    )


async def test_inbox_read_only_own_events(api, store):
    a, b = wallet(store), wallet(store)
    event = TradeOrder(
        owner_id=a,
        symbol="005930",
        exchange="KRX",
        side="BUY",
        order_type="MARKET",
        quantity=1,
        status="FILLED",
        fill_price=100,
        processed_at=datetime.now(UTC),
    )
    store.add(event)
    await store.flush()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        headers = {"X-Test-Owner": str(a)}
        feed = await client.get("/api/personal/inbox", headers=headers)
        key = feed.json()["items"][0]["key"]
        assert feed.json()["items"][0]["read"] is False
        assert (
            await client.post(
                "/api/personal/inbox/read",
                json={"keys": [key]},
                headers={"X-Test-Owner": str(b)},
            )
        ).status_code == 404
        assert (
            await client.post(
                "/api/personal/inbox/read", json={"keys": [key]}, headers=headers
            )
        ).status_code == 200
        assert (await client.get("/api/personal/inbox", headers=headers)).json()[
            "items"
        ][0]["read"] is True


async def test_inbox_cursor_keeps_all_same_timestamp_events(api, store):
    from app.services.inbox_cursor import event_order

    owner, other = wallet(store), wallet(store)
    at = datetime.now(UTC) - timedelta(minutes=1)
    expected = set()
    for index in range(75):
        for event in (
            TradeOrder(
                owner_id=owner,
                symbol="005930",
                exchange="KRX",
                side="BUY",
                order_type="MARKET",
                quantity=1,
                status="FILLED",
                fill_price=100,
                created_at=at,
                processed_at=at,
            ),
            MoneyEvent(
                owner_id=owner,
                kind="FX",
                request_key=str(index),
                status="BOOKED",
                data={"message": "환전 완료"},
                created_at=at,
                updated_at=at,
            ),
            SupportTicket(
                owner_id=owner,
                request_key=str(index),
                fingerprint="test",
                category="BUG",
                subject="답변 검증",
                body="내용",
                reply="답변",
                status="ANSWERED",
                created_at=at,
                updated_at=at,
            ),
        ):
            store.add(event)
            await store.flush()
            expected.add(str(event.id))
    store.add(
        MoneyEvent(
            owner_id=other,
            kind="FX",
            request_key="other",
            status="BOOKED",
            data={},
            updated_at=at,
        )
    )
    await store.flush()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        headers = {"X-Test-Owner": str(owner)}
        params = {}
        collected = []
        for _ in range(10):
            response = await client.get(
                "/api/personal/inbox", headers=headers, params=params
            )
            assert response.status_code == 200
            page = response.json()
            assert len(page["items"]) <= 50
            collected.extend(page["items"])
            if not page["hasMore"]:
                assert page["nextCursor"] is None
                break
            assert page["nextCursor"]
            params = {"cursor": page["nextCursor"]}
        assert len(collected) == 225
        assert len({item["key"] for item in collected}) == 225
        assert {item["key"].split(":")[1] for item in collected} == expected
        assert collected == sorted(collected, key=event_order, reverse=True)
        assert all(
            item["href"] == "/account-tools?tab=HISTORY"
            for item in collected
            if item["category"] == "ACCOUNT"
        )
        filtered = (
            await client.get("/api/personal/inbox?category=ORDER", headers=headers)
        ).json()
        second = (
            await client.get(
                "/api/personal/inbox",
                headers=headers,
                params={"category": "ORDER", "cursor": filtered["nextCursor"]},
            )
        ).json()
        assert len(filtered["items"]) == 50 and len(second["items"]) == 25
        assert not second["hasMore"]
        # Read acknowledgements on earlier pages do not change pagination order.
        keys = [item["key"] for item in collected[:50]]
        assert (
            await client.post(
                "/api/personal/inbox/read", json={"keys": keys}, headers=headers
            )
        ).status_code == 200
        assert all(
            item["read"]
            for item in (
                await client.get("/api/personal/inbox", headers=headers)
            ).json()["items"]
        )
        legacy = await client.get(
            "/api/personal/inbox", headers=headers, params={"before": at.isoformat()}
        )
        assert legacy.status_code == 200 and legacy.json()["items"] == []


@pytest.mark.parametrize(
    "cursor",
    ["not-a-cursor", "W10=", "bnVsbA==", "WzEsbnVsbCwiYXNkIiwxXQ==", "x" * 513],
)
async def test_inbox_rejects_invalid_cursor(api, store, cursor):
    owner = wallet(store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/personal/inbox",
            params={"cursor": cursor},
            headers={"X-Test-Owner": str(owner)},
        )
        assert response.status_code == 422


async def test_plan_api_duplicate_validation_and_owner(api, store):
    a, b = wallet(store), wallet(store)
    payload = {
        "requestKey": "schedule-00001",
        "symbol": "005930",
        "market": "KR",
        "exchange": "KRX",
        "amount": "500000",
        "weekday": 2,
        "localTime": "10:00",
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        headers = {"X-Test-Owner": str(a)}
        first = await client.post(
            "/api/personal/recurring", json=payload, headers=headers
        )
        assert first.status_code == 200
        same = await client.post(
            "/api/personal/recurring", json=payload, headers=headers
        )
        assert same.json()["id"] == first.json()["id"]
        assert (
            await client.patch(
                f"/api/personal/recurring/{first.json()['id']}",
                json={"active": False},
                headers={"X-Test-Owner": str(b)},
            )
        ).status_code == 404
        assert (
            await client.patch(
                f"/api/personal/recurring/{first.json()['id']}",
                json={"active": False},
                headers=headers,
            )
        ).json()["active"] is False
        payload["localTime"] = "99:99"
        assert (
            await client.post("/api/personal/recurring", json=payload, headers=headers)
        ).status_code == 422


async def test_malformed_saved_and_operator_denied(api, store):
    owner = wallet(store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        headers = {"X-Test-Owner": str(owner)}
        response = await client.put(
            "/api/personal/saved/FAVORITE/KR:KRX:005930",
            json={"data": {"symbol": {}, "exchange": "KRX"}, "version": 0},
            headers=headers,
        )
        assert response.status_code == 422
        assert (
            await client.get("/api/personal/operations", headers=headers)
        ).status_code == 401


async def test_split_pending_order_blocks_without_money_change(store):
    owner = wallet(store)
    now = datetime.now(UTC)
    store.add(
        TradeOrder(
            owner_id=owner,
            symbol="AAPL",
            exchange="NAS",
            side="BUY",
            order_type="MARKET",
            quantity=4,
            fill_price=100,
            status="FILLED",
            processed_at=now - timedelta(days=2),
        )
    )
    store.add(
        TradeOrder(
            owner_id=owner,
            symbol="AAPL",
            exchange="NAS",
            side="SELL",
            order_type="LIMIT",
            quantity=1,
            status="OPEN",
        )
    )
    position = Position(
        owner_id=owner, symbol="AAPL", exchange="NAS", quantity=4, average_price=100
    )
    action = CorporateAction(
        source_key="split-block-test-001",
        symbol="AAPL",
        market="US",
        exchange="NAS",
        currency="USD",
        kind="SPLIT",
        ratio=Decimal(2),
        cutoff_at=now - timedelta(minutes=1),
        pay_at=now - timedelta(minutes=1),
        source_url="https://www.sec.gov/Archives/test",
    )
    store.add(position)
    store.add(action)
    await store.flush()
    result = await apply_action(store, owner, action)
    assert (
        result.status == "BLOCKED"
        and position.quantity == 4
        and position.average_price == 100
    )
    from app.services.personal_ledger import split_pending

    assert await split_pending(store, owner, "AAPL", "NAS") is True


async def test_recurring_insufficient_cash_records_skip(store):
    owner = wallet(store, krw=10)
    now = datetime(2026, 10, 14, 1, 0, tzinfo=UTC)
    item = next(row for row in TOP_INSTRUMENTS if row.symbol == "005930")
    plan = RecurringPlan(
        owner_id=owner,
        request_key="weekly-funds-test-001",
        fingerprint="x" * 64,
        symbol=item.symbol,
        market="KR",
        exchange="KRX",
        name=item.name,
        currency="KRW",
        amount=1000000,
        weekday=2,
        local_time="10:00",
        timezone="Asia/Seoul",
        next_at=now,
    )
    store.add(plan)
    await store.flush()
    quote = {
        "price": 100000,
        "marketState": "LIVE",
        "asOf": datetime.now(UTC).isoformat(),
        "volume": 1000000,
    }
    from unittest.mock import patch

    with patch("app.services.personal_worker.live_regular", return_value=True):
        result = await run_plan(store, plan.id, item, quote, now)
    assert result.status == "SKIPPED" and "부족" in result.reason
    assert store.session.scalar(sa.select(sa.func.count()).select_from(TradeOrder)) == 0


async def test_operator_reply_notice_and_future_action(api, store):
    from types import SimpleNamespace

    from app.core.identity import require_operator

    owner = wallet(store)
    operator = uuid4()
    api.dependency_overrides[require_operator] = lambda: SimpleNamespace(id=operator)
    ticket = SupportTicket(
        owner_id=owner,
        request_key="support-admin-0001",
        fingerprint="x" * 64,
        category="BUG",
        subject="오류 문의",
        body="내역 확인 요청합니다",
    )
    store.add(ticket)
    await store.flush()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/api/personal/operations/support/{ticket.id}",
            json={"reply": "확인을 완료했어요.", "status": "ANSWERED"},
        )
        assert (
            response.status_code == 200
            and response.json()["reply"] == "확인을 완료했어요."
        )
        notice = {
            "requestKey": "notice-admin-test-0001",
            "title": "서비스 점검",
            "body": "예정된 서비스 점검입니다.",
        }
        first = await client.post("/api/personal/operations/notices", json=notice)
        second = await client.post("/api/personal/operations/notices", json=notice)
        assert first.json()["id"] == second.json()["id"]
        assert (await client.get("/api/personal/notices")).json()["items"][0][
            "title"
        ] == "서비스 점검"
        assert (
            await client.patch(
                f"/api/personal/operations/notices/{first.json()['id']}",
                json={"active": False},
            )
        ).status_code == 200
        assert (await client.get("/api/personal/notices")).json()["items"] == []
        future = datetime.now(UTC) + timedelta(days=1)
        action = {
            "sourceKey": "dividend-admin-test-0001",
            "symbol": "005930",
            "exchange": "KRX",
            "kind": "DIVIDEND",
            "perShare": "350",
            "cutoffAt": future.isoformat(),
            "payAt": (future + timedelta(days=5)).isoformat(),
            "sourceUrl": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=verified",
        }
        result = await client.post("/api/personal/operations/corporate", json=action)
        assert result.status_code == 200
        action["sourceKey"] = "dividend-admin-test-0002"
        assert (
            await client.post("/api/personal/operations/corporate", json=action)
        ).status_code == 409
        cancel = await client.patch(
            f"/api/personal/operations/corporate/{result.json()['id']}"
        )
        assert cancel.json()["status"] == "CANCELED"
        action["cutoffAt"] = (datetime.now(UTC) - timedelta(days=1)).isoformat()
        assert (
            await client.post("/api/personal/operations/corporate", json=action)
        ).status_code == 422


async def test_corporate_guard_does_not_freeze_separate_practice_ledger(store):
    from app.services.personal_ledger import split_pending

    owner = wallet(store)
    now = datetime.now(UTC)
    store.add(PracticeRound(owner_id=uuid4(), ledger_owner_id=owner))
    store.add(
        TradeOrder(
            owner_id=owner,
            symbol="AAPL",
            exchange="NAS",
            side="BUY",
            order_type="MARKET",
            quantity=4,
            status="FILLED",
            fill_price=100,
            processed_at=now - timedelta(days=2),
        )
    )
    store.add(
        CorporateAction(
            source_key="split-private-scope-test",
            symbol="AAPL",
            market="US",
            exchange="NAS",
            currency="USD",
            kind="SPLIT",
            ratio=2,
            cutoff_at=now - timedelta(minutes=1),
            pay_at=now - timedelta(minutes=1),
            source_url="https://www.sec.gov/Archives/test",
        )
    )
    await store.flush()
    assert await split_pending(store, owner, "AAPL", "NAS") is False


async def test_domestic_provider_uses_official_output1(monkeypatch):
    from contextlib import asynccontextmanager

    from app.core.config import settings
    from app.core.traffic import traffic_store
    from app.services.kis_market import kis_market
    from app.services.personal_data import corporate_schedule

    monkeypatch.setattr(settings, "kis_app_key", "fixture-only")
    monkeypatch.setattr(settings, "kis_app_secret", "fixture-only")

    @asynccontextmanager
    async def slot():
        yield

    async def rate_limit():
        pass

    async def token():
        return "fixture-token"

    async def cache(key, ttl, loader):
        return await loader()

    observed = datetime.now(UTC).strftime("%Y%m%d")

    def response(request):
        if request.url.path.endswith("dividend"):
            return httpx.Response(
                200,
                json={
                    "rt_cd": "0",
                    "output1": [
                        {
                            "record_date": observed,
                            "sht_cd": "005930",
                            "per_sto_divi_amt": "350",
                            "divi_pay_dt": observed,
                        }
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "rt_cd": "0",
                "output1": [
                    {
                        "record_date": observed,
                        "sht_cd": "005930",
                        "inter_bf_face_amt": "1000",
                        "inter_af_face_amt": "500",
                        "list_dt": observed,
                    }
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        monkeypatch.setattr(kis_market, "_client", lambda: client)
        monkeypatch.setattr(kis_market, "_rest_slot", slot)
        monkeypatch.setattr(kis_market, "_rate_limit_rest", rate_limit)
        monkeypatch.setattr(kis_market, "_token", token)
        monkeypatch.setattr(traffic_store, "get_or_set", cache)
        result = await corporate_schedule(
            next(row for row in TOP_INSTRUMENTS if row.symbol == "005930")
        )
    assert result["partial"] is False and len(result["items"]) == 2
    assert (
        result["items"][0]["perShare"] == "350" and result["items"][1]["ratio"] == "2"
    )


async def test_worker_cycles_beyond_first_50_actions(store, monkeypatch):
    import app.services.personal_worker as worker_module
    from app.core.traffic import traffic_store

    now = datetime.now(UTC) - timedelta(minutes=5)
    for index in range(51):
        store.add(
            CorporateAction(
                id=UUID(f"a0000000-0000-0000-0000-{index:012x}"),
                source_key=f"cursor-action-test-{index}",
                symbol="005930",
                market="KR",
                exchange="KRX",
                currency="KRW",
                kind="DIVIDEND",
                per_share=350,
                cutoff_at=now,
                pay_at=now,
                source_url="https://dart.fss.or.kr/",
            )
        )
    await store.flush()
    state = {}

    async def get(key):
        return state.get(key)

    async def put(key, value, ttl):
        state[key] = value

    monkeypatch.setattr(traffic_store, "get_json", get)
    monkeypatch.setattr(traffic_store, "set_json", put)
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def context():
        yield store

    class Factory:
        def __call__(self):
            return context()

        def begin(self):
            return context()

    monkeypatch.setattr(worker_module, "AsyncSessionLocal", Factory())
    worker = worker_module.PersonalWorker()
    await worker.poll()
    first = state["personal:corporate:cursor"]["after"]
    await worker.poll()
    second = state["personal:corporate:cursor"]["after"]
    assert first != second and UUID(second) == UUID(
        "a0000000-0000-0000-0000-000000000032"
    )
    await worker.poll()
    assert state["personal:corporate:cursor"] == {}
