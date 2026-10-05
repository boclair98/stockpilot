"""Toss-only rewarded restart. Never modify existing/competitive account cash."""

from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import current_identity
from app.core.order_integrity import normalize_idempotency_key
from app.models import (
    PracticeRewardTicket,
    PracticeRound,
    PracticeState,
    ProtectionPlan,
    TradeOrder,
    TradingAccount,
    User,
)
from app.services.audit import record_audit
from app.services.practice_rewards import (
    DAILY_LIMIT,
    RESET_COOLDOWN,
    TEST_REWARDED_GROUP,
    TICKET_LIFETIME,
    check_reset_limits,
    check_reward_ticket,
    utc,
)

router = APIRouter(prefix="/api/toss-practice", tags=["toss-practice"])


async def toss_owner(request: Request) -> UUID:
    identity = current_identity(request)
    if not identity:
        raise HTTPException(401, "로그인이 필요합니다.")
    if identity.provider != "toss":
        raise HTTPException(403, "앱인토스에서 사용할 수 있어요.")
    return identity.id


class PrepareReward(BaseModel):
    model_config = ConfigDict(extra="forbid")
    adGroupId: str = Field(min_length=1, max_length=100)


class CompleteReward(PrepareReward):
    ticketId: UUID
    eventType: Literal["userEarnedReward"]
    unitType: str = Field(min_length=1, max_length=64)
    unitAmount: float = Field(gt=0, le=1_000_000_000, allow_inf_nan=False)


class SelectScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: Literal["original", "active"]


def allowed_group(group: str) -> bool:
    return bool(settings.toss_practice_rewarded_group) and (
        group == settings.toss_practice_rewarded_group
        or (settings.toss_practice_allow_test_ads and group == TEST_REWARDED_GROUP)
    )


async def lock_state(session: AsyncSession, owner: UUID) -> PracticeState:
    await session.execute(
        pg_insert(PracticeState)
        .values(owner_id=owner)
        .on_conflict_do_nothing(index_elements=[PracticeState.owner_id])
    )
    return await session.scalar(
        sa.select(PracticeState)
        .where(PracticeState.owner_id == owner)
        .with_for_update()
    )


async def count_today(session: AsyncSession, owner: UUID, now: datetime) -> int:
    day_start = (
        now.astimezone(timezone(timedelta(hours=9)))
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(UTC)
    )
    return int(
        await session.scalar(
            sa.select(sa.func.count(PracticeRound.id)).where(
                PracticeRound.owner_id == owner,
                PracticeRound.created_at >= day_start,
            )
        )
        or 0
    )


def ticket_body(ticket: PracticeRewardTicket) -> dict:
    return {"ticketId": str(ticket.id), "expiresAt": utc(ticket.expires_at).isoformat()}


async def committed_response(session: AsyncSession, body: dict) -> JSONResponse:
    # Never send success before the transaction has committed.
    await session.flush()
    await session.commit()
    return JSONResponse(body, headers={"Cache-Control": "no-store"})


@router.get("/state")
async def practice_state(
    owner: UUID = Depends(toss_owner), session: AsyncSession = Depends(get_session)
) -> JSONResponse:
    state = await session.get(PracticeState, owner)
    rows = list(
        (
            await session.execute(
                sa.select(PracticeRound)
                .where(PracticeRound.owner_id == owner)
                .order_by(PracticeRound.created_at.desc())
                .limit(10)
            )
        ).scalars()
    )
    now = datetime.now(UTC)
    used_today = await count_today(session, owner, now)
    retry_at = (
        utc(state.last_reset_at) + RESET_COOLDOWN
        if state and state.last_reset_at
        else None
    )
    return JSONResponse(
        {
            "selectedScope": state.selected_scope if state else "original",
            "enabled": bool(settings.toss_practice_rewarded_group),
            "adGroupId": settings.toss_practice_rewarded_group or None,
            "activeRoundId": str(state.active_round_id)
            if state and state.active_round_id
            else None,
            "initialCash": {"KRW": 100_000_000, "USD": 100_000},
            "remainingToday": max(0, DAILY_LIMIT - used_today),
            "availableAt": retry_at.isoformat()
            if retry_at and retry_at > now
            else None,
            "rounds": [
                {"id": str(row.id), "createdAt": utc(row.created_at).isoformat()}
                for row in rows
            ],
        },
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/select")
async def select_scope(
    payload: SelectScope,
    owner: UUID = Depends(toss_owner),
    session: AsyncSession = Depends(get_session),
) -> dict:
    state = await lock_state(session, owner)
    if payload.scope == "active" and not state.active_round_id:
        raise HTTPException(409, "사용할 새 연습 계좌가 없어요.")
    state.selected_scope = payload.scope
    await session.flush()
    await session.commit()
    return {"selectedScope": state.selected_scope}


@router.post("/rewards/prepare")
async def prepare_reward(
    payload: PrepareReward,
    owner: UUID = Depends(toss_owner),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
) -> JSONResponse:
    try:
        key = normalize_idempotency_key(idempotency_key)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if not key:
        raise HTTPException(400, "초기화 요청 번호가 필요합니다.")
    if not allowed_group(payload.adGroupId):
        raise HTTPException(503, "새로 시작하기를 아직 준비하고 있어요.")
    state = await lock_state(session, owner)
    existing = await session.scalar(
        sa.select(PracticeRewardTicket).where(
            PracticeRewardTicket.owner_id == owner,
            PracticeRewardTicket.request_key == key,
        )
    )
    if existing:
        check_reward_ticket(existing, owner, payload.adGroupId, datetime.now(UTC))
        return await committed_response(session, ticket_body(existing))
    now = datetime.now(UTC)
    check_reset_limits(state.last_reset_at, await count_today(session, owner, now), now)
    # Reserve one benefit across devices BEFORE they spend time watching.
    pending = await session.scalar(
        sa.select(PracticeRewardTicket)
        .where(
            PracticeRewardTicket.owner_id == owner,
            PracticeRewardTicket.round_id.is_(None),
            PracticeRewardTicket.expires_at > now,
        )
        .order_by(PracticeRewardTicket.created_at.desc())
        .limit(1)
    )
    if pending:
        check_reward_ticket(pending, owner, payload.adGroupId, now)
        return await committed_response(session, ticket_body(pending))
    await session.execute(
        pg_insert(User)
        .values(coders_id=owner, display_name=f"toss-{str(owner)[:8]}")
        .on_conflict_do_nothing(index_elements=[User.coders_id])
    )
    ticket = PracticeRewardTicket(
        id=uuid4(),
        owner_id=owner,
        request_key=key,
        ad_group_id=payload.adGroupId,
        expires_at=now + TICKET_LIFETIME,
        created_at=now,
    )
    session.add(ticket)
    await session.flush()
    return await committed_response(session, ticket_body(ticket))


@router.post("/rewards/complete")
async def complete_reward(
    payload: CompleteReward,
    request: Request,
    owner: UUID = Depends(toss_owner),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    state = await lock_state(session, owner)
    ticket = await session.scalar(
        sa.select(PracticeRewardTicket)
        .where(
            PracticeRewardTicket.id == payload.ticketId,
            PracticeRewardTicket.owner_id == owner,
        )
        .with_for_update()
    )
    if not ticket:
        raise HTTPException(404, "광고 이용권을 다시 확인해 주세요.")
    now = datetime.now(UTC)
    check_reward_ticket(ticket, owner, payload.adGroupId, now)
    if ticket.round_id:
        return await committed_response(
            session, {"status": "completed", "roundId": str(ticket.round_id)}
        )
    check_reset_limits(state.last_reset_at, await count_today(session, owner, now), now)
    # SDK callbacks have no signed receipt. This bounded noncash benefit MUST
    # remain NONCOMPETITIVE. Never grant paid or leaderboard balances from it.
    # Retry a lost HTTP response with the SAME ticket, without watching again.
    if state.active_round_id:
        previous = await session.get(PracticeRound, state.active_round_id)
        if previous and previous.owner_id == owner:
            await session.execute(
                sa.update(TradeOrder)
                .where(
                    TradeOrder.owner_id == previous.ledger_owner_id,
                    TradeOrder.status.in_(["OPEN", "TRIGGERED"]),
                )
                .values(status="CANCELED")
            )
            await session.execute(
                sa.update(ProtectionPlan)
                .where(
                    ProtectionPlan.owner_id == previous.ledger_owner_id,
                    ProtectionPlan.status == "ACTIVE",
                )
                .values(status="CANCELED")
            )
    row = PracticeRound(
        id=uuid4(), owner_id=owner, ledger_owner_id=uuid4(), created_at=now
    )
    session.add(row)
    session.add(
        TradingAccount(
            owner_id=row.ledger_owner_id,
            cash=Decimal("100000"),
            cash_krw=Decimal("100000000"),
        )
    )
    await session.flush()
    ticket.round_id = row.id
    state.active_round_id = row.id
    state.selected_scope = "active"
    state.last_reset_at = now
    record_audit(
        session,
        actor_id=owner,
        event_type="PRACTICE_RESTART",
        entity_type="practice_round",
        entity_id=row.id,
        request_id=getattr(request.state, "request_id", str(uuid4())),
        details={"verification": "sdk_callback", "competitive": False},
    )
    return await committed_response(
        session, {"status": "completed", "roundId": str(row.id)}
    )
