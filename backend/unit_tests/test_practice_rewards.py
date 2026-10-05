"""Local SQLite transaction tests, NOT a PostgreSQL concurrency certification."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
import sqlalchemy as sa
from app.core.config import settings
from app.core.identity import encode_signed
from app.core.practice import optional_practice_identity
from app.models import (
    AuditEvent,
    PracticeRewardTicket,
    PracticeRound,
    PracticeState,
    ProtectionPlan,
    TradeOrder,
    TradingAccount,
    User,
)
from app.routes.practice import (
    CompleteReward,
    PrepareReward,
    SelectScope,
    complete_reward,
    prepare_reward,
    select_scope,
    toss_owner,
)
from app.services.practice_rewards import check_reset_limits, check_reward_ticket
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.requests import Request


class AsyncFacade:
    def __init__(self, sync):
        self.sync = sync
        self.statements = []

    async def execute(self, query):
        self.statements.append(str(query))
        return self.sync.execute(query)

    async def scalar(self, query):
        self.statements.append(str(query))
        return self.sync.scalar(query)

    async def get(self, model, key):
        return self.sync.get(model, key)

    def add(self, row):
        self.sync.add(row)

    async def flush(self):
        self.sync.flush()

    async def commit(self):
        self.sync.commit()


@pytest.fixture
def database(monkeypatch):
    monkeypatch.setattr(settings, "toss_practice_rewarded_group", "fixture-group")
    engine = sa.create_engine("sqlite://")
    tables = [
        User,
        TradingAccount,
        PracticeState,
        PracticeRound,
        PracticeRewardTicket,
        TradeOrder,
        ProtectionPlan,
        AuditEvent,
    ]
    for model in tables:
        model.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as sync:
        yield AsyncFacade(sync)
    engine.dispose()


def request(owner=None, scope=None, provider="toss", method="GET"):
    settings.auth_session_secret = "unit-test-only-secret-never-production"
    headers = []
    if owner:
        token = encode_signed({"id": str(owner), "provider": provider}, "toss-access")
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if scope:
        headers.append((b"x-stockpilot-practice", scope.encode()))
    return Request(
        {
            "type": "http",
            "method": method,
            "path": "/api/trading/portfolio",
            "headers": headers,
            "query_string": b"",
        }
    )


@pytest.mark.asyncio
async def test_restart_is_exact_independent_noncompetitive_and_idempotent(database):
    owner, other = uuid4(), uuid4()
    database.add(
        TradingAccount(
            owner_id=owner, cash=Decimal("12.34"), cash_krw=Decimal("96304304")
        )
    )
    database.add(
        TradingAccount(owner_id=other, cash=Decimal("55"), cash_krw=Decimal("777"))
    )
    await database.flush()
    receipt = await prepare_reward(
        PrepareReward(adGroupId="fixture-group"), owner, database, str(uuid4())
    )
    claim = CompleteReward(
        ticketId=json.loads(receipt.body)["ticketId"],
        adGroupId="fixture-group",
        eventType="userEarnedReward",
        unitType="practice",
        unitAmount=1,
    )
    result = await complete_reward(claim, request(owner), owner, database)
    await database.flush()
    database.sync.commit()
    again = await complete_reward(claim, request(owner), owner, database)
    assert json.loads(result.body) == json.loads(again.body)
    assert database.sync.scalar(sa.select(sa.func.count(PracticeRound.id))) == 1
    round_row = database.sync.scalar(sa.select(PracticeRound))
    wallet = await database.get(TradingAccount, round_row.ledger_owner_id)
    assert wallet.cash_krw == Decimal("100000000.00") and wallet.cash == Decimal(
        "100000.00"
    )
    assert (await database.get(TradingAccount, owner)).cash_krw == Decimal(
        "96304304.00"
    )
    assert (await database.get(TradingAccount, other)).cash_krw == Decimal("777.00")
    assert await optional_practice_identity(request(owner), database) == owner
    assert (
        await optional_practice_identity(request(owner, "active"), database)
        == round_row.ledger_owner_id
    )
    assert any("FOR UPDATE" in sql for sql in database.statements)
    assert await optional_practice_identity(request(owner, "selected"), database) == round_row.ledger_owner_id
    await select_scope(SelectScope(scope="original"), owner, database)
    assert await optional_practice_identity(request(owner, "selected"), database) == owner
    await select_scope(SelectScope(scope="active"), owner, database)
    assert (await database.get(PracticeState, owner)).selected_scope == "active"


@pytest.mark.asyncio
async def test_tickets_cannot_be_used_by_another_user_or_replaced_group(database):
    owner = uuid4()
    receipt = await prepare_reward(
        PrepareReward(adGroupId="fixture-group"), owner, database, str(uuid4())
    )
    claim = CompleteReward(
        ticketId=json.loads(receipt.body)["ticketId"],
        adGroupId="fixture-group",
        eventType="userEarnedReward",
        unitType="practice",
        unitAmount=1,
    )
    with pytest.raises(HTTPException) as e:
        await complete_reward(claim, request(uuid4()), uuid4(), database)
    assert e.value.status_code == 404
    claim.adGroupId = "wrong-group"
    with pytest.raises(HTTPException) as e:
        await complete_reward(claim, request(owner), owner, database)
    assert e.value.status_code == 403
    assert database.sync.scalar(sa.select(sa.func.count(PracticeRound.id))) == 0


@pytest.mark.asyncio
async def test_prepare_reserves_one_ticket_before_watch_across_devices(database):
    owner = uuid4()
    a = await prepare_reward(
        PrepareReward(adGroupId="fixture-group"), owner, database, str(uuid4())
    )
    b = await prepare_reward(
        PrepareReward(adGroupId="fixture-group"), owner, database, str(uuid4())
    )
    assert json.loads(a.body)["ticketId"] == json.loads(b.body)["ticketId"]
    assert database.sync.scalar(sa.select(sa.func.count(TradingAccount.owner_id))) == 0


@pytest.mark.asyncio
async def test_arbitrary_scope_and_missing_active_round_fail_closed(database):
    owner = uuid4()
    for scope in ("active", str(uuid4())):
        with pytest.raises(HTTPException):
            await optional_practice_identity(request(owner, scope), database)
    with pytest.raises(HTTPException):
        await toss_owner(request())


@pytest.mark.parametrize("event", ["dismissed", "impression", "clicked"])
def test_nonreward_event_is_rejected(event):
    with pytest.raises(ValidationError):
        CompleteReward(
            ticketId=uuid4(),
            adGroupId="fixture-group",
            eventType=event,
            unitType="practice",
            unitAmount=1,
        )


def test_expired_unused_ticket_and_limits_are_enforced():
    now = datetime.now(UTC)
    owner = uuid4()
    ticket = PracticeRewardTicket(
        owner_id=owner,
        ad_group_id="fixture-group",
        expires_at=now - timedelta(seconds=1),
    )
    with pytest.raises(HTTPException):
        check_reward_ticket(ticket, owner, "fixture-group", now)
    ticket.round_id = uuid4()
    check_reward_ticket(ticket, owner, "fixture-group", now)
    with pytest.raises(HTTPException):
        check_reset_limits(now - timedelta(minutes=5), 0, now)
    with pytest.raises(HTTPException):
        check_reset_limits(None, 3, now)
    check_reset_limits(now - timedelta(hours=2), 2, now)


@pytest.mark.asyncio
async def test_next_restart_cancels_only_archived_practice_orders(database):
    owner = uuid4()
    first = await prepare_reward(
        PrepareReward(adGroupId="fixture-group"), owner, database, str(uuid4())
    )
    first_claim = CompleteReward(
        ticketId=json.loads(first.body)["ticketId"],
        adGroupId="fixture-group",
        eventType="userEarnedReward",
        unitType="practice",
        unitAmount=1,
    )
    await complete_reward(first_claim, request(owner), owner, database)
    await database.flush()
    state = await database.get(PracticeState, owner)
    first_round = await database.get(PracticeRound, state.active_round_id)
    original_order = TradeOrder(
        owner_id=owner,
        symbol="005930",
        exchange="KRX",
        side="BUY",
        order_type="LIMIT",
        quantity=1,
        limit_price=1000,
        status="OPEN",
    )
    practice_order = TradeOrder(
        owner_id=first_round.ledger_owner_id,
        symbol="005930",
        exchange="KRX",
        side="BUY",
        order_type="LIMIT",
        quantity=1,
        limit_price=1000,
        status="OPEN",
    )
    protection = ProtectionPlan(
        owner_id=first_round.ledger_owner_id,
        symbol="005930",
        exchange="KRX",
        quantity=1,
        take_profit_price=1200,
        stop_loss_price=800,
        status="ACTIVE",
    )
    for row in (original_order, practice_order, protection):
        database.add(row)
    state.last_reset_at = datetime.now(UTC) - timedelta(hours=2)
    await database.flush()
    second = await prepare_reward(
        PrepareReward(adGroupId="fixture-group"), owner, database, str(uuid4())
    )
    second_claim = CompleteReward(
        ticketId=json.loads(second.body)["ticketId"],
        adGroupId="fixture-group",
        eventType="userEarnedReward",
        unitType="practice",
        unitAmount=1,
    )
    await complete_reward(second_claim, request(owner), owner, database)
    await database.flush()
    assert original_order.status == "OPEN"
    assert practice_order.status == "CANCELED"
    assert protection.status == "CANCELED"
    assert database.sync.scalar(sa.select(sa.func.count(PracticeRound.id))) == 2
