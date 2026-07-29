"""Privacy-first leaderboard for StockPilot paper-trading accounts."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.models import (
    LeagueParticipant,
    LeagueRankSnapshot,
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


def combined_return_rate(krw_equity: Decimal, usd_equity: Decimal) -> Decimal:
    """Equal-weight both wallets so FX moves cannot alter league standings."""

    krw_factor = krw_equity / INITIAL_KRW
    usd_factor = usd_equity / INITIAL_USD
    return ((krw_factor + usd_factor) / Decimal("2") - Decimal("1")) * Decimal(
        "100"
    )


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
    accounts = {
        row.owner_id: row
        for row in (
            await session.execute(
                sa.select(TradingAccount).where(
                    TradingAccount.owner_id.in_(owner_ids)
                )
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

    equity = {
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

    for position in positions:
        quantity = Decimal(position.quantity)
        if quantity <= 0:
            continue
        instrument = await instrument_catalog.get(
            position.symbol, exchange=position.exchange
        )
        if not instrument:
            continue
        quote = kis_market.quote(
            position.symbol, instrument.market, position.exchange
        )
        if not quote:
            try:
                quote = await kis_market.fetch_quote(instrument)
            except Exception:
                quote = None
        price = (
            Decimal(str(quote["price"]))
            if quote and quote.get("price") is not None
            else Decimal(position.average_price)
        )
        equity[position.owner_id][instrument.currency] += quantity * price

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


async def _rankings_payload(
    session: AsyncSession, owner: UUID | None = None
) -> dict:
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
    me = {"joined": False}
    for index, row in enumerate(scored, start=1):
        participant = row["participant"]
        return_rate = row["returnRate"].quantize(Decimal("0.0001"))
        prior_rank = previous_ranks.get(participant.id)
        rank_change = prior_rank - index if prior_rank else 0
        public_row = {
            "rank": index,
            "nickname": participant.nickname,
            "returnRate": float(return_rate),
            "rankChange": rank_change,
            "isMe": participant.owner_id == owner,
        }
        rankings.append(public_row)
        if participant.owner_id == owner:
            me = {
                "joined": True,
                "nickname": participant.nickname,
                "rank": index,
                "returnRate": float(return_rate),
                "rankChange": rank_change,
            }
        await session.execute(
            pg_insert(LeagueRankSnapshot)
            .values(
                participant_id=participant.id,
                snapshot_date=today,
                rank=index,
                return_rate=return_rate,
            )
            .on_conflict_do_update(
                constraint="uq_league_snapshot_participant_date",
                set_={"rank": index, "return_rate": return_rate},
            )
        )

    return {
        "title": "StockPilot 오픈 리그",
        "participantCount": len(rankings),
        "asOf": datetime.now(UTC).isoformat(),
        "rankings": rankings[:100],
        "me": me,
        "rules": {
            "startingCapital": "모든 계정은 ₩1억 + $10만으로 시작",
            "scoring": "한국·미국 계좌 수익률을 50:50으로 합산",
            "privacy": "닉네임·순위·수익률만 공개",
            "trading": "StockPilot의 기존 가상거래 결과를 사용",
        },
    }


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
    return {"left": True}
