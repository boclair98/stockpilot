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
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.core.traffic import traffic_store
from app.models import (
    ChallengeAccount,
    ChallengeOrder,
    ChallengePosition,
    LeagueParticipant,
    LeagueRankSnapshot,
    LeagueRoom,
    LeagueRoomMember,
    Position,
    TradingAccount,
)
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market
from app.services.risk_engine import load_control, quote_age_seconds

router = APIRouter(prefix="/api/league", tags=["league"])

INITIAL_KRW = Decimal("100000000")
INITIAL_USD = Decimal("100000")
CHALLENGE_KRW = Decimal("1000000")
SEOUL = timezone(timedelta(hours=9))
NICKNAME_PATTERN = re.compile(r"^[0-9A-Za-z가-힣_-]+$")
ROOM_NAME_PATTERN = re.compile(r"^[0-9A-Za-z가-힣 _-]+$")
OPEN_RANKINGS_CACHE_KEY = "league:open-rankings:v3"


def challenge_return_rate(equity_krw: Decimal) -> Decimal:
    return ((equity_krw / CHALLENGE_KRW - Decimal("1")) * 100).quantize(Decimal("0.0001"))


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
    mode: Literal["SEASON", "DUEL", "CHALLENGE"] = "SEASON"
    maxMembers: int = Field(default=3, ge=3, le=10)

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


class ChallengeOrderIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=12)
    exchange: Literal["KRX", "NXT"] = "KRX"
    side: Literal["BUY", "SELL"]
    quantity: int = Field(ge=1, le=10000)


async def _challenge_equity(session: AsyncSession, room: LeagueRoom, members: list[LeagueRoomMember]) -> tuple[dict[UUID, Decimal], dict[UUID, list[dict]]]:
    accounts = {row.owner_id: row for row in (await session.execute(sa.select(ChallengeAccount).where(ChallengeAccount.room_id == room.id))).scalars()}
    positions = list((await session.execute(sa.select(ChallengePosition).where(ChallengePosition.room_id == room.id))).scalars())
    keys = sorted({(row.symbol, row.exchange) for row in positions})
    instruments = dict(zip(keys, await asyncio.gather(*(instrument_catalog.get(symbol, "KR", exchange) for symbol, exchange in keys)), strict=True))

    async def market_price(key: tuple[str, str]) -> Decimal | None:
        item = instruments[key]
        if not item:
            return None
        quote = kis_market.quote(item.symbol, item.market, item.exchange)
        if not quote:
            try:
                quote = await kis_market.fetch_quote(item)
            except Exception:
                quote = None
        return Decimal(str(quote["price"])) if quote and quote.get("price") else None

    prices = dict(zip(keys, await asyncio.gather(*(market_price(key) for key in keys)), strict=True))
    equity = {member.owner_id: Decimal(accounts[member.owner_id].cash_krw) if member.owner_id in accounts else CHALLENGE_KRW for member in members}
    private_positions: dict[UUID, list[dict]] = {member.owner_id: [] for member in members}
    for row in positions:
        price = prices.get((row.symbol, row.exchange)) or Decimal(row.average_price)
        equity[row.owner_id] += price * row.quantity
        private_positions[row.owner_id].append({"symbol": row.symbol, "exchange": row.exchange, "quantity": row.quantity, "currentPrice": float(price), "priceAvailable": prices.get((row.symbol, row.exchange)) is not None})
    return equity, private_positions


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
    if room.mode == "CHALLENGE":
        challenge_equity, private_positions = await _challenge_equity(session, room, members)
        account = await session.get(ChallengeAccount, (room.id, owner))
        rankings = [
            {
                "nickname": item.nickname,
                "returnRate": float(challenge_return_rate(challenge_equity[item.owner_id])),
                "isMe": item.owner_id == owner,
                "joinedAt": item.joined_at.isoformat(),
            }
            for item in members
        ]
        rankings.sort(key=lambda row: (-row["returnRate"], row["joinedAt"]))
        for rank, row in enumerate(rankings, start=1):
            row["rank"] = rank
        return {
            "id": str(room.id), "name": room.name, "inviteCode": room.invite_code,
            "mode": room.mode, "maxMembers": room.max_members,
            "status": _room_status(room), "startsAt": room.starts_at.isoformat(),
            "endsAt": room.ends_at.isoformat(), "participantCount": len(members),
            "isOwner": room.owner_id == owner, "rankings": rankings,
            "startingCashKrw": float(CHALLENGE_KRW),
            "myCashKrw": float(account.cash_krw) if account else float(CHALLENGE_KRW),
            "myPositions": private_positions.get(owner, []),
            "pricingNote": "실제 조회 시세 기반 가상거래. 시세 장애 시 마지막 매수가로 임시 평가할 수 있습니다.",
        }
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
    current = (await _owner_equity(session, [owner]))[owner] if payload.mode != "CHALLENGE" else {"KRW": CHALLENGE_KRW, "USD": INITIAL_USD}
    now = datetime.now(UTC)
    waiting_start = now + timedelta(days=3650)
    room = LeagueRoom(
        owner_id=owner,
        name=payload.name.strip(),
        invite_code=await _new_invite_code(session),
        mode=payload.mode,
        max_members=2 if payload.mode == "DUEL" else payload.maxMembers if payload.mode == "CHALLENGE" else 100,
        duration_days=payload.durationDays,
        starts_at=waiting_start if payload.mode == "CHALLENGE" else now,
        ends_at=(waiting_start if payload.mode == "CHALLENGE" else now) + timedelta(days=payload.durationDays),
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
    if payload.mode == "CHALLENGE":
        session.add(ChallengeAccount(room_id=room.id, owner_id=owner, cash_krw=CHALLENGE_KRW))
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
        ).with_for_update()
    )
    if not room:
        raise HTTPException(404, "초대코드가 올바르지 않습니다.")
    if _room_status(room) == "ENDED":
        raise HTTPException(409, "이미 종료된 리그입니다.")
    if room.mode == "CHALLENGE" and _room_status(room) != "UPCOMING":
        raise HTTPException(409, "이미 시작한 챌린지에는 참여할 수 없습니다.")
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
    current = (await _owner_equity(session, [owner]))[owner] if room.mode != "CHALLENGE" else {"KRW": CHALLENGE_KRW, "USD": INITIAL_USD}
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
    if room.mode == "CHALLENGE":
        session.add(ChallengeAccount(room_id=room.id, owner_id=owner, cash_krw=CHALLENGE_KRW))
        if (member_count or 0) + 1 == room.max_members:
            room.starts_at = datetime.now(UTC)
            room.ends_at = room.starts_at + timedelta(days=room.duration_days)
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
    if room.mode == "CHALLENGE" and _room_status(room) != "UPCOMING":
        raise HTTPException(409, "시작된 챌린지에서는 나갈 수 없습니다.")
    member = await session.scalar(
        sa.select(LeagueRoomMember).where(
            LeagueRoomMember.league_id == room_id,
            LeagueRoomMember.owner_id == owner,
        )
    )
    if not member:
        raise HTTPException(404, "참여 중인 리그가 아닙니다.")
    await session.delete(member)
    if room.mode == "CHALLENGE":
        account = await session.get(ChallengeAccount, (room.id, owner))
        if account:
            await session.delete(account)
    return {"left": True}


@router.post("/rooms/{room_id}/challenge-orders", status_code=201)
async def challenge_order(
    room_id: UUID,
    payload: ChallengeOrderIn,
    idempotency_key: str = Header(min_length=8, max_length=80),
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Room-only virtual market order, serialized per member account."""

    room = await session.get(LeagueRoom, room_id)
    if not room or room.mode != "CHALLENGE":
        raise HTTPException(404, "친구 챌린지를 찾을 수 없습니다.")
    if _room_status(room) != "ACTIVE":
        raise HTTPException(409, "모든 참가자가 모여 챌린지가 시작된 뒤 주문할 수 있습니다.")
    if settings.trading_mode.upper() != "SIMULATION" or (await load_control(session)).halted:
        raise HTTPException(503, "현재 가상거래가 일시 중지되었습니다.")
    account = await session.scalar(sa.select(ChallengeAccount).where(
        ChallengeAccount.room_id == room_id,
        ChallengeAccount.owner_id == owner,
    ).with_for_update())
    if not account:
        raise HTTPException(403, "이 챌린지에 참여하지 않았습니다.")
    prior = await session.scalar(sa.select(ChallengeOrder).where(
        ChallengeOrder.room_id == room_id,
        ChallengeOrder.owner_id == owner,
        ChallengeOrder.request_key == idempotency_key,
    ))
    if prior:
        if (prior.symbol, prior.exchange, prior.side, prior.quantity) != (payload.symbol.upper(), payload.exchange, payload.side, payload.quantity):
            raise HTTPException(409, "같은 요청 키로 다른 주문을 보낼 수 없습니다.")
        return {"id": str(prior.id), "status": "FILLED", "fillPrice": float(prior.fill_price), "replayed": True}
    daily_orders = await session.scalar(sa.select(sa.func.count()).where(
        ChallengeOrder.room_id == room_id,
        ChallengeOrder.owner_id == owner,
        ChallengeOrder.created_at >= datetime.now(UTC) - timedelta(days=1),
    ))
    if (daily_orders or 0) >= 100:
        raise HTTPException(429, "하루 가상주문 한도 100건에 도달했습니다.")
    instrument = await instrument_catalog.get(payload.symbol.upper(), "KR", payload.exchange)
    if not instrument or instrument.market != "KR":
        raise HTTPException(404, "국내 종목을 찾을 수 없습니다.")
    current = await kis_market.fetch_quote(instrument)
    if not current or not current.get("price"):
        raise HTTPException(503, "실제 시세를 확인할 수 없어 가상주문을 중지했습니다.")
    quote_age = quote_age_seconds(current)
    if quote_age is None or quote_age > settings.market_data_max_age_seconds:
        raise HTTPException(503, "시세가 오래되어 가상주문을 중지했습니다.")
    price = Decimal(str(current["price"]))
    if price <= 0:
        raise HTTPException(503, "유효한 시세를 확인할 수 없습니다.")
    cost = (price * payload.quantity).quantize(Decimal("0.01"))
    position = await session.scalar(sa.select(ChallengePosition).where(
        ChallengePosition.room_id == room_id,
        ChallengePosition.owner_id == owner,
        ChallengePosition.symbol == instrument.symbol,
        ChallengePosition.exchange == instrument.exchange,
    ).with_for_update())
    if payload.side == "BUY":
        if cost > account.cash_krw:
            raise HTTPException(409, "챌린지 가상 현금이 부족합니다.")
        if not position:
            open_positions = await session.scalar(sa.select(sa.func.count()).where(
                ChallengePosition.room_id == room_id,
                ChallengePosition.owner_id == owner,
            ))
            if (open_positions or 0) >= 20:
                raise HTTPException(409, "챌린지의 보유 종목은 최대 20개입니다.")
        account.cash_krw -= cost
        if position:
            position.average_price = (position.average_price * position.quantity + cost) / (position.quantity + payload.quantity)
            position.quantity += payload.quantity
        else:
            session.add(ChallengePosition(room_id=room_id, owner_id=owner, symbol=instrument.symbol, exchange=instrument.exchange, quantity=payload.quantity, average_price=price))
    else:
        if not position or position.quantity < payload.quantity:
            raise HTTPException(409, "챌린지에서 보유한 수량만 매도할 수 있습니다.")
        account.cash_krw += cost
        position.quantity -= payload.quantity
        if position.quantity == 0:
            await session.delete(position)
    order = ChallengeOrder(room_id=room_id, owner_id=owner, request_key=idempotency_key, symbol=instrument.symbol, exchange=instrument.exchange, side=payload.side, quantity=payload.quantity, fill_price=price)
    session.add(order)
    await session.flush()
    return {"id": str(order.id), "status": "FILLED", "fillPrice": float(price), "replayed": False}
