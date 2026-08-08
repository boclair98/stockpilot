"""Privacy-first leaderboard for StockPilot paper-trading accounts."""

from __future__ import annotations

import asyncio
import re
import secrets
import string
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.core.traffic import traffic_store
from app.models import (
    LeagueParticipant,
    LeagueRankSnapshot,
    LeagueRoom,
    LeagueRoomMember,
    Position,
    TradingAccount,
)
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market

router = APIRouter(prefix="/api/league", tags=["league"])

INITIAL_KRW = Decimal("100000000")
INITIAL_USD = Decimal("100000")
SEOUL = timezone(timedelta(hours=9))
NICKNAME_PATTERN = re.compile(r"^[0-9A-Za-z가-힣_-]+$")
ROOM_NAME_PATTERN = re.compile(r"^[0-9A-Za-z가-힣 _-]+$")
OPEN_RANKINGS_CACHE_KEY = "league:open-rankings:v3"


class JoinIn(BaseModel):
    nickname: str | None = Field(default=None, min_length=2, max_length=12)

    @field_validator("nickname")
    @classmethod
    def validate_nickname(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not 2 <= len(value) <= 12 or not NICKNAME_PATTERN.fullmatch(value):
            raise ValueError("닉네임은 한글·영문·숫자·_-만 2~12자로 입력하세요.")
        return value


class RoomCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=24)
    nickname: str = Field(min_length=2, max_length=12)
    durationDays: int = Field(default=30, ge=1, le=90)
    mode: Literal["SEASON", "DUEL"] = "SEASON"

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not ROOM_NAME_PATTERN.fullmatch(value):
            raise ValueError(
                "리그 이름에는 한글·영문·숫자·공백·_-만 사용할 수 있습니다."
            )
        return value

    @field_validator("nickname")
    @classmethod
    def validate_create_nickname(cls, value: str) -> str:
        value = value.strip()
        if not NICKNAME_PATTERN.fullmatch(value):
            raise ValueError("닉네임은 한글·영문·숫자·_-만 사용할 수 있습니다.")
        return value

    @model_validator(mode="after")
    def validate_duration(self) -> RoomCreateIn:
        allowed = {1, 3, 7} if self.mode == "DUEL" else {7, 14, 30, 60}
        if self.durationDays not in allowed:
            raise ValueError("대결 또는 시즌에서 제공하는 기간을 선택해 주세요.")
        return self


class RoomJoinIn(BaseModel):
    inviteCode: str = Field(min_length=6, max_length=10)
    nickname: str = Field(min_length=2, max_length=12)

    @field_validator("nickname")
    @classmethod
    def validate_room_nickname(cls, value: str) -> str:
        value = value.strip()
        if not NICKNAME_PATTERN.fullmatch(value):
            raise ValueError("닉네임은 한글·영문·숫자·_-만 사용할 수 있습니다.")
        return value


def combined_return_rate(krw_equity: Decimal, usd_equity: Decimal) -> Decimal:
    """Equal-weight both wallets so FX moves cannot alter league standings."""

    krw_factor = krw_equity / INITIAL_KRW
    usd_factor = usd_equity / INITIAL_USD
    return ((krw_factor + usd_factor) / Decimal("2") - Decimal("1")) * Decimal("100")


def _default_nickname(owner: UUID) -> str:
    return f"파일럿-{owner.hex[-6:].upper()}"


async def _unique_default_nickname(session: AsyncSession, owner: UUID) -> str:
    base = _default_nickname(owner)
    nickname = base
    suffix = 2
    while await session.scalar(
        sa.select(sa.literal(True)).where(LeagueParticipant.nickname == nickname)
    ):
        nickname = f"{base[:10]}{suffix}"
        suffix += 1
    return nickname


async def _score_participants(
    session: AsyncSession, participants: list[LeagueParticipant]
) -> list[dict]:
    if not participants:
        return []

    owner_ids = [participant.owner_id for participant in participants]
    equity = await _owner_equity(session, owner_ids)

    scored = [
        {
            "participant": participant,
            "returnRate": combined_return_rate(
                equity[participant.owner_id]["KRW"],
                equity[participant.owner_id]["USD"],
            ),
        }
        for participant in participants
    ]
    scored.sort(
        key=lambda row: (
            -row["returnRate"],
            row["participant"].joined_at or datetime.now(UTC),
            row["participant"].nickname,
        )
    )
    return scored


async def _owner_equity(
    session: AsyncSession, owner_ids: list[UUID]
) -> dict[UUID, dict[str, Decimal]]:
    accounts = {
        row.owner_id: row
        for row in (
            await session.execute(
                sa.select(TradingAccount).where(TradingAccount.owner_id.in_(owner_ids))
            )
        )
        .scalars()
        .all()
    }
    positions = (
        (
            await session.execute(
                sa.select(Position).where(Position.owner_id.in_(owner_ids))
            )
        )
        .scalars()
        .all()
    )

    equity: dict[UUID, dict[str, Decimal]] = {
        owner_id: {
            "KRW": Decimal(accounts[owner_id].cash_krw)
            if owner_id in accounts
            else INITIAL_KRW,
            "USD": Decimal(accounts[owner_id].cash)
            if owner_id in accounts
            else INITIAL_USD,
        }
        for owner_id in owner_ids
    }

    instrument_keys = sorted(
        {
            (position.symbol, position.exchange)
            for position in positions
            if Decimal(position.quantity) > 0
        }
    )
    resolved = await asyncio.gather(
        *(
            instrument_catalog.get(symbol, exchange=exchange)
            for symbol, exchange in instrument_keys
        )
    )
    instruments = dict(zip(instrument_keys, resolved, strict=True))

    async def current_price(key: tuple[str, str]) -> Decimal | None:
        instrument = instruments[key]
        if not instrument:
            return None
        quote = kis_market.quote(
            instrument.symbol, instrument.market, instrument.exchange
        )
        if not quote:
            try:
                quote = await kis_market.fetch_quote(instrument)
            except Exception:
                quote = None
        return (
            Decimal(str(quote["price"]))
            if quote and quote.get("price") is not None
            else None
        )

    price_values = await asyncio.gather(
        *(current_price(key) for key in instrument_keys)
    )
    prices = dict(zip(instrument_keys, price_values, strict=True))

    for position in positions:
        quantity = Decimal(position.quantity)
        if quantity <= 0:
            continue
        key = (position.symbol, position.exchange)
        instrument = instruments.get(key)
        if not instrument:
            continue
        price = prices.get(key) or Decimal(position.average_price)
        equity[position.owner_id][instrument.currency] += quantity * price

    return equity


def _room_status(room: LeagueRoom) -> str:
    now = datetime.now(UTC)
    if now < room.starts_at:
        return "UPCOMING"
    if now >= room.ends_at:
        return "ENDED"
    return "ACTIVE"


async def _room_payload(session: AsyncSession, room: LeagueRoom, owner: UUID) -> dict:
    members = (
        (
            await session.execute(
                sa.select(LeagueRoomMember)
                .where(LeagueRoomMember.league_id == room.id)
                .order_by(LeagueRoomMember.joined_at)
            )
        )
        .scalars()
        .all()
    )
    member = next((item for item in members if item.owner_id == owner), None)
    if not member:
        raise HTTPException(403, "참여 중인 리그만 볼 수 있습니다.")
    equity = await _owner_equity(session, [item.owner_id for item in members])
    rankings = []
    for item in members:
        current = equity[item.owner_id]
        baseline_krw = Decimal(item.baseline_krw) or INITIAL_KRW
        baseline_usd = Decimal(item.baseline_usd) or INITIAL_USD
        score = (
            (current["KRW"] / baseline_krw + current["USD"] / baseline_usd)
            / Decimal("2")
            - Decimal("1")
        ) * Decimal("100")
        rankings.append(
            {
                "nickname": item.nickname,
                "returnRate": float(score.quantize(Decimal("0.0001"))),
                "isMe": item.owner_id == owner,
                "joinedAt": item.joined_at.isoformat(),
            }
        )
    rankings.sort(key=lambda row: (-row["returnRate"], row["joinedAt"]))
    for rank, row in enumerate(rankings, start=1):
        row["rank"] = rank
    return {
        "id": str(room.id),
        "name": room.name,
        "inviteCode": room.invite_code,
        "mode": room.mode,
        "maxMembers": room.max_members,
        "status": _room_status(room),
        "startsAt": room.starts_at.isoformat(),
        "endsAt": room.ends_at.isoformat(),
        "participantCount": len(rankings),
        "isOwner": room.owner_id == owner,
        "rankings": rankings,
    }


async def _new_invite_code(session: AsyncSession) -> str:
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(10):
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        exists = await session.scalar(
            sa.select(LeagueRoom.id).where(LeagueRoom.invite_code == code)
        )
        if not exists:
            return code
    raise HTTPException(503, "초대코드를 만들지 못했습니다. 다시 시도해 주세요.")


async def _compute_rankings_base(session: AsyncSession) -> dict:
    participants = (
        (
            await session.execute(
                sa.select(LeagueParticipant)
                .where(LeagueParticipant.active.is_(True))
                .order_by(LeagueParticipant.joined_at)
            )
        )
        .scalars()
        .all()
    )
    scored = await _score_participants(session, participants)
    today = datetime.now(SEOUL).date()
    previous_date = await session.scalar(
        sa.select(sa.func.max(LeagueRankSnapshot.snapshot_date)).where(
            LeagueRankSnapshot.snapshot_date < today
        )
    )
    previous_ranks: dict[UUID, int] = {}
    if previous_date:
        previous_ranks = dict(
            (
                await session.execute(
                    sa.select(
                        LeagueRankSnapshot.participant_id,
                        LeagueRankSnapshot.rank,
                    ).where(LeagueRankSnapshot.snapshot_date == previous_date)
                )
            ).all()
        )

    rankings = []
    snapshots = []
    for index, row in enumerate(scored, start=1):
        participant = row["participant"]
        return_rate = row["returnRate"].quantize(Decimal("0.0001"))
        prior_rank = previous_ranks.get(participant.id)
        rank_change = prior_rank - index if prior_rank else 0
        public_row = {
            "ownerId": str(participant.owner_id),
            "participantId": str(participant.id),
            "rank": index,
            "nickname": participant.nickname,
            "returnRate": float(return_rate),
            "rankChange": rank_change,
        }
        rankings.append(public_row)
        snapshots.append(
            {
                "participant_id": participant.id,
                "snapshot_date": today,
                "rank": index,
                "return_rate": return_rate,
            }
        )

    if snapshots:
        statement = pg_insert(LeagueRankSnapshot).values(snapshots)
        await session.execute(
            statement.on_conflict_do_update(
                constraint="uq_league_snapshot_participant_date",
                set_={
                    "rank": statement.excluded.rank,
                    "return_rate": statement.excluded.return_rate,
                },
            )
        )

    return {
        "title": "StockPilot 오픈 리그",
        "participantCount": len(rankings),
        "asOf": datetime.now(UTC).isoformat(),
        # Only the public top 100 is cached. Personal rows outside the top 100
        # are read from the compact daily snapshot table below.
        "rankings": rankings[:100],
        "rules": {
            "startingCapital": "모든 계정은 ₩1억 + $10만으로 시작",
            "scoring": "한국·미국 계좌 수익률을 50:50으로 합산",
            "privacy": "닉네임·순위·수익률만 공개",
            "trading": "StockPilot의 기존 가상거래 결과를 사용",
        },
    }


async def _rankings_payload(session: AsyncSession, owner: UUID | None = None) -> dict:
    base = await traffic_store.get_or_set(
        OPEN_RANKINGS_CACHE_KEY,
        settings.leaderboard_cache_seconds,
        lambda: _compute_rankings_base(session),
    )
    top_rows = base["rankings"]
    rankings = [
        {
            key: value
            for key, value in row.items()
            if key not in {"ownerId", "participantId"}
        }
        | {"isMe": row["ownerId"] == str(owner)}
        for row in top_rows
    ]
    me = {"joined": False}
    if owner:
        top_me = next((row for row in top_rows if row["ownerId"] == str(owner)), None)
        if top_me:
            me = {
                "joined": True,
                "nickname": top_me["nickname"],
                "rank": top_me["rank"],
                "returnRate": top_me["returnRate"],
                "rankChange": top_me["rankChange"],
            }
        else:
            participant = await session.scalar(
                sa.select(LeagueParticipant).where(
                    LeagueParticipant.owner_id == owner,
                    LeagueParticipant.active.is_(True),
                )
            )
            if participant:
                snapshot = await session.scalar(
                    sa.select(LeagueRankSnapshot).where(
                        LeagueRankSnapshot.participant_id == participant.id,
                        LeagueRankSnapshot.snapshot_date == datetime.now(SEOUL).date(),
                    )
                )
                if snapshot:
                    previous_date = await session.scalar(
                        sa.select(sa.func.max(LeagueRankSnapshot.snapshot_date)).where(
                            LeagueRankSnapshot.snapshot_date < snapshot.snapshot_date
                        )
                    )
                    prior_rank = (
                        await session.scalar(
                            sa.select(LeagueRankSnapshot.rank).where(
                                LeagueRankSnapshot.participant_id == participant.id,
                                LeagueRankSnapshot.snapshot_date == previous_date,
                            )
                        )
                        if previous_date
                        else None
                    )
                    me = {
                        "joined": True,
                        "nickname": participant.nickname,
                        "rank": snapshot.rank,
                        "returnRate": float(snapshot.return_rate),
                        "rankChange": (prior_rank - snapshot.rank) if prior_rank else 0,
                    }
    return {**base, "rankings": rankings, "me": me}


@router.get("/rankings")
async def rankings(
    owner: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await _rankings_payload(session, owner)


@router.post("/join", status_code=201)
async def join(
    payload: JoinIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    participant = await session.scalar(
        sa.select(LeagueParticipant).where(LeagueParticipant.owner_id == owner)
    )
    if participant and participant.active:
        raise HTTPException(409, "이미 리그에 참여하고 있습니다.")

    nickname = payload.nickname or await _unique_default_nickname(session, owner)
    duplicate = await session.scalar(
        sa.select(LeagueParticipant.id).where(
            LeagueParticipant.nickname == nickname,
            LeagueParticipant.owner_id != owner,
        )
    )
    if duplicate:
        raise HTTPException(409, "이미 사용 중인 닉네임입니다.")

    if participant:
        participant.nickname = nickname
        participant.active = True
        participant.joined_at = datetime.now(UTC)
    else:
        session.add(
            LeagueParticipant(
                owner_id=owner,
                nickname=nickname,
                joined_at=datetime.now(UTC),
            )
        )
    await session.flush()
    await traffic_store.delete(OPEN_RANKINGS_CACHE_KEY)
    return await _rankings_payload(session, owner)


@router.delete("/join")
async def leave(
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    participant = await session.scalar(
        sa.select(LeagueParticipant).where(
            LeagueParticipant.owner_id == owner,
            LeagueParticipant.active.is_(True),
        )
    )
    if not participant:
        raise HTTPException(404, "참여 중인 리그가 없습니다.")
    participant.active = False
    await traffic_store.delete(OPEN_RANKINGS_CACHE_KEY)
    return {"left": True}


@router.get("/rooms")
async def rooms(
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    room_rows = (
        (
            await session.execute(
                sa.select(LeagueRoom)
                .join(
                    LeagueRoomMember,
                    LeagueRoomMember.league_id == LeagueRoom.id,
                )
                .where(LeagueRoomMember.owner_id == owner)
                .order_by(LeagueRoom.ends_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return {"rooms": [await _room_payload(session, room, owner) for room in room_rows]}


@router.get("/rooms/{room_id}")
async def room_detail(
    room_id: UUID,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    room = await session.get(LeagueRoom, room_id)
    if not room:
        raise HTTPException(404, "리그를 찾을 수 없습니다.")
    return await _room_payload(session, room, owner)


@router.post("/rooms", status_code=201)
async def create_room(
    payload: RoomCreateIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    room_count = await session.scalar(
        sa.select(sa.func.count()).where(LeagueRoom.owner_id == owner)
    )
    if (room_count or 0) >= 10:
        raise HTTPException(409, "만들 수 있는 비공개 리그는 최대 10개입니다.")
    current = (await _owner_equity(session, [owner]))[owner]
    now = datetime.now(UTC)
    room = LeagueRoom(
        owner_id=owner,
        name=payload.name.strip(),
        invite_code=await _new_invite_code(session),
        mode=payload.mode,
        max_members=2 if payload.mode == "DUEL" else 100,
        starts_at=now,
        ends_at=now + timedelta(days=payload.durationDays),
    )
    session.add(room)
    await session.flush()
    session.add(
        LeagueRoomMember(
            league_id=room.id,
            owner_id=owner,
            nickname=payload.nickname.strip(),
            baseline_krw=current["KRW"],
            baseline_usd=current["USD"],
        )
    )
    await session.flush()
    return await _room_payload(session, room, owner)


@router.post("/rooms/join", status_code=201)
async def join_room(
    payload: RoomJoinIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    room = await session.scalar(
        sa.select(LeagueRoom).where(
            LeagueRoom.invite_code == payload.inviteCode.strip().upper()
        )
    )
    if not room:
        raise HTTPException(404, "초대코드가 올바르지 않습니다.")
    if _room_status(room) == "ENDED":
        raise HTTPException(409, "이미 종료된 리그입니다.")
    existing = await session.scalar(
        sa.select(LeagueRoomMember).where(
            LeagueRoomMember.league_id == room.id,
            LeagueRoomMember.owner_id == owner,
        )
    )
    if existing:
        return await _room_payload(session, room, owner)
    member_count = await session.scalar(
        sa.select(sa.func.count()).where(LeagueRoomMember.league_id == room.id)
    )
    if (member_count or 0) >= room.max_members:
        message = (
            "이미 상대가 참여해 1:1 대결이 가득 찼습니다."
            if room.mode == "DUEL"
            else "리그 참여 인원이 가득 찼습니다."
        )
        raise HTTPException(409, message)
    duplicate_name = await session.scalar(
        sa.select(LeagueRoomMember.id).where(
            LeagueRoomMember.league_id == room.id,
            LeagueRoomMember.nickname == payload.nickname.strip(),
        )
    )
    if duplicate_name:
        raise HTTPException(409, "리그에서 이미 사용 중인 닉네임입니다.")
    current = (await _owner_equity(session, [owner]))[owner]
    session.add(
        LeagueRoomMember(
            league_id=room.id,
            owner_id=owner,
            nickname=payload.nickname.strip(),
            baseline_krw=current["KRW"],
            baseline_usd=current["USD"],
        )
    )
    await session.flush()
    return await _room_payload(session, room, owner)


@router.delete("/rooms/{room_id}/membership")
async def leave_room(
    room_id: UUID,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    room = await session.get(LeagueRoom, room_id)
    if not room:
        raise HTTPException(404, "리그를 찾을 수 없습니다.")
    if room.owner_id == owner:
        raise HTTPException(409, "방장은 리그를 나갈 수 없습니다.")
    member = await session.scalar(
        sa.select(LeagueRoomMember).where(
            LeagueRoomMember.league_id == room_id,
            LeagueRoomMember.owner_id == owner,
        )
    )
    if not member:
        raise HTTPException(404, "참여 중인 리그가 아닙니다.")
    await session.delete(member)
    return {"left": True}
