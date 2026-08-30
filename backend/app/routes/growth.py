"""Daily practice, private trade journals, and responsible skill scoring."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.models import (
    DailyChallengeAttempt,
    PortfolioDailySnapshot,
    Position,
    ProtectionPlan,
    TradeJournal,
    TradeOrder,
    User,
)
from app.routes.engagement import _equity, combined_return_rate
from app.services.benchmark import build_benchmark_report
from app.services.instrument_catalog import Instrument, instrument_catalog
from app.services.kis_market import kis_market
from app.services.portfolio_analytics import (
    ExecutionPoint,
    SnapshotPoint,
    build_portfolio_analytics,
)

router = APIRouter(prefix="/api/growth", tags=["growth"])

SEOUL = timezone(timedelta(hours=9))
CHALLENGE_INSTRUMENTS = (
    ("005930", "KR", "KRX"),
    ("000660", "KR", "KRX"),
    ("035420", "KR", "KRX"),
    ("AAPL", "US", "NAS"),
    ("MSFT", "US", "NAS"),
    ("TSLA", "US", "NAS"),
)


class ChallengeAnswerIn(BaseModel):
    choice: Literal["BUY", "HOLD", "SELL"]


class JournalIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=12)
    exchange: str = Field(min_length=3, max_length=8)
    thesis: str = Field(min_length=5, max_length=500)
    horizon: Literal["DAY", "WEEK", "MONTH", "LONG"]
    targetReturn: Decimal | None = Field(default=None, ge=-100, le=1000)
    stopLoss: Decimal | None = Field(default=None, ge=-100, le=0)
    confidence: int = Field(ge=1, le=5)


class JournalReviewIn(BaseModel):
    review: str = Field(min_length=5, max_length=500)
    outcome: Literal["WIN", "LOSS", "EVEN", "OPEN"]


async def _challenge(day: date) -> tuple[dict, Instrument | None]:
    preset = CHALLENGE_INSTRUMENTS[day.toordinal() % len(CHALLENGE_INSTRUMENTS)]
    instrument = await instrument_catalog.get(*preset)
    if not instrument:
        return {"available": False, "date": day.isoformat()}, None
    history = await kis_market.daily_history(instrument)
    if len(history) < 8:
        return {"available": False, "date": day.isoformat()}, instrument

    candidate_count = min(30, len(history) - 6)
    outcome_index = len(history) - 1 - (day.toordinal() % candidate_count)
    outcome_index = max(5, outcome_index)
    context = history[outcome_index - 5 : outcome_index]
    outcome = history[outcome_index]
    start_price = Decimal(str(context[-1]["close"]))
    end_price = Decimal(str(outcome["close"]))
    move = (
        (end_price / start_price - Decimal("1")) * Decimal("100")
        if start_price
        else Decimal("0")
    )
    direction = "BUY" if move > Decimal("0.4") else "SELL"
    if abs(move) <= Decimal("0.4"):
        direction = "HOLD"
    return (
        {
            "available": True,
            "date": day.isoformat(),
            "market": instrument.market,
            "currency": instrument.currency,
            "context": [
                {
                    "step": index + 1,
                    "open": item["open"],
                    "high": item["high"],
                    "low": item["low"],
                    "close": item["close"],
                    "volume": item["volume"],
                }
                for index, item in enumerate(context)
            ],
            "_startPrice": start_price,
            "_endPrice": end_price,
            "_move": move,
            "_direction": direction,
        },
        instrument,
    )


def _challenge_public(
    challenge: dict,
    instrument: Instrument | None,
    attempt: DailyChallengeAttempt | None,
    distribution: dict[str, int],
) -> dict:
    public = {key: value for key, value in challenge.items() if not key.startswith("_")}
    total = sum(distribution.values())
    public["answered"] = attempt is not None
    public["distribution"] = {
        key: round(value / total * 100) if total else 0
        for key, value in distribution.items()
    }
    if attempt and instrument:
        public["result"] = {
            "choice": attempt.choice,
            "score": attempt.score,
            "correctChoice": challenge["_direction"],
            "movePercent": float(challenge["_move"]),
            "name": instrument.name,
            "symbol": instrument.symbol,
            "exchange": instrument.exchange,
            "outcomePrice": float(challenge["_endPrice"]),
        }
    return public


def _streak(attempt_days: list[date], today: date) -> int:
    unique = set(attempt_days)
    expected = today if today in unique else today - timedelta(days=1)
    streak = 0
    while expected in unique:
        streak += 1
        expected -= timedelta(days=1)
    return streak


def _skill_scores(
    combined: Decimal,
    history: list[PortfolioDailySnapshot],
    filled_count: int,
    journals: list[TradeJournal],
) -> dict:
    values = [float(item.return_rate) for item in history]
    peak = values[0] if values else 0.0
    max_drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        max_drawdown = max(max_drawdown, peak - value)
    return_score = max(0, min(100, 50 + float(combined) * 5))
    risk_score = max(0, min(100, 100 - max_drawdown * 8))
    planned = sum(
        1
        for row in journals
        if row.target_return is not None and row.stop_loss is not None
    )
    reviewed = sum(1 for row in journals if row.reviewed_at is not None)
    discipline = min(100, 30 + min(planned, 5) * 8 + min(reviewed, 5) * 6)
    experience = min(100, filled_count * 5)
    overall = round(
        return_score * 0.30 + risk_score * 0.30 + discipline * 0.25 + experience * 0.15
    )
    grade = "새싹"
    if overall >= 85:
        grade = "에이스"
    elif overall >= 70:
        grade = "균형형"
    elif overall >= 55:
        grade = "성장형"
    return {
        "overall": overall,
        "grade": grade,
        "return": round(return_score),
        "risk": round(risk_score),
        "discipline": round(discipline),
        "experience": round(experience),
        "maxDrawdown": round(max_drawdown, 2),
    }


def _license_mission(
    key: str,
    title: str,
    description: str,
    current: int,
    target: int,
    unit: str,
    href: str,
    *,
    completed: bool | None = None,
) -> dict:
    safe_current = max(0, current)
    return {
        "key": key,
        "title": title,
        "description": description,
        "current": safe_current,
        "target": target,
        "unit": unit,
        "href": href,
        "completed": safe_current >= target if completed is None else completed,
    }


def _investment_license(
    *,
    challenge_count: int,
    filled_order_count: int,
    journal_count: int,
    planned_journal_count: int,
    reviewed_journal_count: int,
    protection_count: int,
    distinct_instrument_count: int,
    snapshot_count: int,
    streak: int,
    risk_score: int,
) -> dict:
    """Derive an educational credential from server-verified behavior."""

    stages = [
        {
            "key": "EXPLORER",
            "level": 1,
            "title": "시장 탐색 면허",
            "summary": "시세를 읽고 첫 계획과 첫 가상주문을 남겨요.",
            "missions": [
                _license_mission(
                    "first-challenge",
                    "익명 차트 판단",
                    "가격 흐름을 보고 상승·횡보·하락을 한 번 판단해요.",
                    challenge_count,
                    1,
                    "회",
                    "#license-challenge",
                ),
                _license_mission(
                    "first-order",
                    "첫 가상주문 체결",
                    "실제 시세를 이용하되 내 돈은 사용하지 않아요.",
                    filled_order_count,
                    1,
                    "회",
                    "/#order-ticket",
                ),
                _license_mission(
                    "first-journal",
                    "첫 투자 근거 기록",
                    "매매 이유를 글로 남겨 충동 주문을 줄여요.",
                    journal_count,
                    1,
                    "회",
                    "#license-journal",
                ),
            ],
        },
        {
            "key": "RISK_PILOT",
            "level": 2,
            "title": "리스크 조종사",
            "summary": "수익 목표보다 먼저 손실 한도를 설계해요.",
            "missions": [
                _license_mission(
                    "planned-journal",
                    "목표·손절 동시 설정",
                    "목표수익률과 손절기준이 모두 있는 계획을 작성해요.",
                    planned_journal_count,
                    1,
                    "개",
                    "#license-journal",
                ),
                _license_mission(
                    "protection-plan",
                    "보호주문 사용",
                    "보유 종목에 익절·손절 보호 범위를 설정해요.",
                    protection_count,
                    1,
                    "개",
                    "/#holdings",
                ),
                _license_mission(
                    "three-instruments",
                    "세 종목 경험",
                    "서로 다른 종목을 거래하며 집중 위험을 체험해요.",
                    distinct_instrument_count,
                    3,
                    "종목",
                    "/#search-card",
                ),
            ],
        },
        {
            "key": "DISCIPLINED",
            "level": 3,
            "title": "원칙 운용사",
            "summary": "예측보다 복기와 반복 가능한 원칙을 평가해요.",
            "missions": [
                _license_mission(
                    "three-reviews",
                    "거래 후 복기",
                    "계획과 실제 행동이 달랐던 이유를 세 번 돌아봐요.",
                    reviewed_journal_count,
                    3,
                    "회",
                    "#license-journal",
                ),
                _license_mission(
                    "three-day-streak",
                    "3일 학습 루틴",
                    "짧더라도 사흘 연속 시장 판단을 기록해요.",
                    streak,
                    3,
                    "일",
                    "#license-challenge",
                ),
                _license_mission(
                    "risk-score",
                    "위험점수 70점",
                    "체결 5회 이후 최대낙폭을 포함한 위험 습관을 평가해요.",
                    risk_score if filled_order_count >= 5 else 0,
                    70,
                    "점",
                    "#license-analytics",
                    completed=filled_order_count >= 5 and risk_score >= 70,
                ),
            ],
        },
        {
            "key": "PORTFOLIO_MASTER",
            "level": 4,
            "title": "포트폴리오 운용 면허",
            "summary": "한 번의 수익보다 여러 날의 분산된 운용을 증명해요.",
            "missions": [
                _license_mission(
                    "seven-snapshots",
                    "7거래일 성과 기록",
                    "단기 결과가 아닌 기간 성과와 최대낙폭을 확인해요.",
                    snapshot_count,
                    7,
                    "일",
                    "#license-analytics",
                ),
                _license_mission(
                    "five-instruments",
                    "다섯 종목 분산 경험",
                    "한 종목에만 의존하지 않는 운용 경험을 쌓아요.",
                    distinct_instrument_count,
                    5,
                    "종목",
                    "/#search-card",
                ),
                _license_mission(
                    "ten-orders",
                    "10회 체결 데이터",
                    "우연이 아닌 반복 가능한 거래 데이터를 만들어요.",
                    filled_order_count,
                    10,
                    "회",
                    "/#order-ticket",
                ),
            ],
        },
    ]

    first_incomplete = next(
        (
            index
            for index, stage in enumerate(stages)
            if not all(mission["completed"] for mission in stage["missions"])
        ),
        None,
    )
    current_index = (
        first_incomplete if first_incomplete is not None else len(stages) - 1
    )
    for index, stage in enumerate(stages):
        completed = all(mission["completed"] for mission in stage["missions"])
        stage["completed"] = completed
        stage["status"] = (
            "COMPLETED"
            if completed
            else "ACTIVE"
            if index == current_index
            else "LOCKED"
        )

    missions = [mission for stage in stages for mission in stage["missions"]]
    completed_count = sum(1 for mission in missions if mission["completed"])
    current_stage = stages[current_index]
    next_mission = next(
        (mission for mission in current_stage["missions"] if not mission["completed"]),
        None,
    )
    completed_stages = sum(1 for stage in stages if stage["completed"])
    tier = (
        "StockPilot 마스터"
        if completed_stages == len(stages)
        else "원칙 운용사"
        if completed_stages >= 3
        else "리스크 조종사"
        if completed_stages >= 2
        else "시장 탐색사"
        if completed_stages >= 1
        else "비행 전 준비생"
    )
    return {
        "tier": tier,
        "progress": round(completed_count / len(missions) * 100),
        "completedMissions": completed_count,
        "totalMissions": len(missions),
        "currentStage": current_stage["key"],
        "nextMission": next_mission,
        "stages": stages,
        "disclaimer": "StockPilot 내부 학습 성취도이며 금융 자격이나 투자 성과를 보증하지 않습니다.",
    }


async def _overview(session: AsyncSession, owner: UUID | None, day: date) -> dict:
    challenge, instrument = await _challenge(day)
    attempt = None
    distribution = {"BUY": 0, "HOLD": 0, "SELL": 0}
    if challenge["available"]:
        rows = (
            await session.execute(
                sa.select(
                    DailyChallengeAttempt.choice,
                    sa.func.count(DailyChallengeAttempt.id),
                )
                .where(DailyChallengeAttempt.challenge_date == day)
                .group_by(DailyChallengeAttempt.choice)
            )
        ).all()
        distribution.update({choice: int(count) for choice, count in rows})
    if not owner:
        return {
            "authenticated": False,
            "challenge": _challenge_public(challenge, instrument, None, distribution),
            "streak": 0,
            "skill": None,
            "weeklyCard": None,
            "journals": [],
            "recentOrders": [],
            "badges": [],
            "license": _investment_license(
                challenge_count=0,
                filled_order_count=0,
                journal_count=0,
                planned_journal_count=0,
                reviewed_journal_count=0,
                protection_count=0,
                distinct_instrument_count=0,
                snapshot_count=0,
                streak=0,
                risk_score=0,
            ),
        }

    attempt = await session.scalar(
        sa.select(DailyChallengeAttempt).where(
            DailyChallengeAttempt.owner_id == owner,
            DailyChallengeAttempt.challenge_date == day,
        )
    )
    attempt_days = list(
        (
            await session.execute(
                sa.select(DailyChallengeAttempt.challenge_date)
                .where(DailyChallengeAttempt.owner_id == owner)
                .order_by(DailyChallengeAttempt.challenge_date.desc())
                .limit(90)
            )
        ).scalars()
    )
    journal_rows = list(
        (
            await session.execute(
                sa.select(TradeJournal)
                .where(TradeJournal.owner_id == owner)
                .order_by(TradeJournal.created_at.desc())
                .limit(20)
            )
        ).scalars()
    )
    orders = list(
        (
            await session.execute(
                sa.select(TradeOrder)
                .where(
                    TradeOrder.owner_id == owner,
                    TradeOrder.status == "FILLED",
                )
                .order_by(TradeOrder.created_at.desc())
                .limit(100)
            )
        ).scalars()
    )
    snapshots = list(
        (
            await session.execute(
                sa.select(PortfolioDailySnapshot)
                .where(PortfolioDailySnapshot.owner_id == owner)
                .order_by(PortfolioDailySnapshot.snapshot_date.desc())
                .limit(30)
            )
        ).scalars()
    )
    snapshots.reverse()
    equity_krw, equity_usd, _ = await _equity(session, owner)
    combined = combined_return_rate(equity_krw, equity_usd)
    scores = _skill_scores(combined, snapshots, len(orders), journal_rows)
    streak = _streak(attempt_days, day)
    user = await session.scalar(sa.select(User).where(User.coders_id == owner))
    week_ago = datetime.now(UTC) - timedelta(days=7)
    weekly_orders = sum(
        1 for order in orders if order.created_at and order.created_at >= week_ago
    )
    weekly_journals = sum(
        1 for row in journal_rows if row.created_at and row.created_at >= week_ago
    )
    protection_count = int(
        await session.scalar(
            sa.select(sa.func.count(ProtectionPlan.id)).where(
                ProtectionPlan.owner_id == owner,
                ProtectionPlan.status.in_(
                    ("ACTIVE", "TRIGGERED", "FILLED", "CANCELED")
                ),
            )
        )
        or 0
    )
    planned_journal_count = sum(
        1
        for row in journal_rows
        if row.target_return is not None and row.stop_loss is not None
    )
    reviewed_journal_count = sum(
        1 for row in journal_rows if row.reviewed_at is not None
    )
    distinct_instrument_count = len(
        {(order.symbol, order.exchange) for order in orders}
    )
    license_data = _investment_license(
        challenge_count=len(attempt_days),
        filled_order_count=len(orders),
        journal_count=len(journal_rows),
        planned_journal_count=planned_journal_count,
        reviewed_journal_count=reviewed_journal_count,
        protection_count=protection_count,
        distinct_instrument_count=distinct_instrument_count,
        snapshot_count=len(snapshots),
        streak=streak,
        risk_score=scores["risk"],
    )

    async def journal_payload(row: TradeJournal) -> dict:
        item = await instrument_catalog.get(row.symbol, exchange=row.exchange)
        return {
            "id": str(row.id),
            "symbol": row.symbol,
            "name": item.name if item else row.symbol,
            "exchange": row.exchange,
            "thesis": row.thesis,
            "horizon": row.horizon,
            "targetReturn": (
                float(row.target_return) if row.target_return is not None else None
            ),
            "stopLoss": float(row.stop_loss) if row.stop_loss is not None else None,
            "confidence": row.confidence,
            "review": row.review,
            "outcome": row.outcome,
            "createdAt": row.created_at.isoformat(),
        }

    recent_orders = []
    seen: set[tuple[str, str]] = set()
    for order in orders:
        key = (order.symbol, order.exchange)
        if key in seen:
            continue
        seen.add(key)
        item = await instrument_catalog.get(order.symbol, exchange=order.exchange)
        recent_orders.append(
            {
                "symbol": order.symbol,
                "name": item.name if item else order.symbol,
                "exchange": order.exchange,
            }
        )
        if len(recent_orders) == 12:
            break

    badges = []
    if attempt_days:
        badges.append({"key": "first-challenge", "label": "첫 예측 완료"})
    if streak >= 3:
        badges.append({"key": "streak-3", "label": f"{streak}일 연속"})
    if len(journal_rows) >= 3:
        badges.append({"key": "journal-3", "label": "복기 습관"})
    if scores["risk"] >= 80 and orders:
        badges.append({"key": "risk-keeper", "label": "리스크 지킴이"})
    return {
        "authenticated": True,
        "challenge": _challenge_public(challenge, instrument, attempt, distribution),
        "streak": streak,
        "skill": scores,
        "weeklyCard": {
            "displayName": user.display_name if user else "StockPilot 사용자",
            "returnRate": float(combined),
            "tradeCount": weekly_orders,
            "journalCount": weekly_journals,
            "streak": streak,
            "skillScore": scores["overall"],
            "grade": scores["grade"],
        },
        "journals": [await journal_payload(row) for row in journal_rows],
        "recentOrders": recent_orders,
        "badges": badges,
        "license": license_data,
    }


@router.get("/overview")
async def overview(
    owner: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await _overview(session, owner, datetime.now(SEOUL).date())


@router.get("/analytics")
async def analytics(
    owner: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return explainable risk and execution metrics without revealing holdings."""

    if not owner:
        return {"authenticated": False, "analytics": None}

    snapshot_rows = list(
        (
            await session.execute(
                sa.select(PortfolioDailySnapshot)
                .where(PortfolioDailySnapshot.owner_id == owner)
                .order_by(PortfolioDailySnapshot.snapshot_date.desc())
                .limit(90)
            )
        ).scalars()
    )
    snapshot_rows.reverse()
    order_rows = list(
        (
            await session.execute(
                sa.select(TradeOrder)
                .where(
                    TradeOrder.owner_id == owner,
                    TradeOrder.status.in_(("FILLED", "REJECTED", "CANCELED")),
                )
                .order_by(TradeOrder.created_at.desc())
                .limit(500)
            )
        ).scalars()
    )
    position_count = await session.scalar(
        sa.select(sa.func.count(Position.id)).where(
            Position.owner_id == owner,
            Position.quantity > 0,
        )
    )
    result = build_portfolio_analytics(
        [
            SnapshotPoint(row.snapshot_date, row.return_rate)
            for row in snapshot_rows
        ],
        [
            ExecutionPoint(
                side=row.side,
                status=row.status,
                realized_pnl=row.realized_pnl,
                slippage_bps=row.slippage_bps,
                spread_bps=row.spread_bps,
            )
            for row in order_rows
        ],
        open_position_count=int(position_count or 0),
    )
    return {"authenticated": True, "analytics": result}


@router.get("/benchmark")
async def benchmark(
    response: Response,
    owner: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Compare the simulation with KOSPI without exposing portfolio holdings.

    KOSPI data is already cached by the KIS collector for five minutes.  The
    response is safe to cache briefly at the edge as it contains only public
    market data unless a logged-in user requests the private comparison.
    """

    response.headers["Cache-Control"] = "private, max-age=60, stale-while-revalidate=60"
    market = await kis_market.kospi_history()
    report = build_benchmark_report(market.get("points") or [])
    report["source"] = market.get("source") or "KIS Open API"
    report["stale"] = bool(market.get("stale"))
    if not owner:
        return {
            "authenticated": False,
            "benchmark": report,
            "comparison": None,
        }

    rows = list(
        (
            await session.execute(
                sa.select(PortfolioDailySnapshot)
                .where(PortfolioDailySnapshot.owner_id == owner)
                .order_by(PortfolioDailySnapshot.snapshot_date.desc())
                .limit(30)
            )
        ).scalars()
    )
    rows.reverse()
    portfolio_series = [
        {
            "date": row.snapshot_date.isoformat(),
            "returnRate": round(float(row.return_rate), 4),
        }
        for row in rows
    ]
    if len(rows) < 2 or len(report["series"]) < 2:
        return {
            "authenticated": True,
            "benchmark": report,
            "comparison": {
                "status": "STARTING",
                "periodDays": len(rows),
                "portfolioReturn": float(rows[-1].return_rate) if rows else None,
                "benchmarkReturn": None,
                "relativeReturn": None,
                "portfolioSeries": portfolio_series,
            },
        }

    period_length = min(len(rows), len(report["series"]), 20)
    portfolio_window = rows[-period_length:]
    benchmark_window = report["series"][-period_length:]
    portfolio_return = float(
        portfolio_window[-1].return_rate - portfolio_window[0].return_rate
    )
    first_value = float(benchmark_window[0]["value"])
    last_value = float(benchmark_window[-1]["value"])
    benchmark_return = (last_value / first_value - 1) * 100 if first_value else None
    relative_return = (
        portfolio_return - benchmark_return
        if benchmark_return is not None
        else None
    )
    status = "MATCH"
    if relative_return is not None:
        status = "AHEAD" if relative_return >= 0.1 else "BEHIND" if relative_return <= -0.1 else "MATCH"
    return {
        "authenticated": True,
        "benchmark": report,
        "comparison": {
            "status": status,
            "periodDays": max(period_length - 1, 1),
            "portfolioReturn": round(portfolio_return, 4),
            "benchmarkReturn": round(benchmark_return, 4) if benchmark_return is not None else None,
            "relativeReturn": round(relative_return, 4) if relative_return is not None else None,
            "portfolioSeries": portfolio_series,
        },
    }


@router.post("/challenge", status_code=201)
async def answer_challenge(
    payload: ChallengeAnswerIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    day = datetime.now(SEOUL).date()
    existing = await session.scalar(
        sa.select(DailyChallengeAttempt).where(
            DailyChallengeAttempt.owner_id == owner,
            DailyChallengeAttempt.challenge_date == day,
        )
    )
    if existing:
        return await _overview(session, owner, day)
    challenge, instrument = await _challenge(day)
    if not challenge["available"] or not instrument:
        raise HTTPException(503, "오늘의 챌린지 시세를 준비하고 있습니다.")
    score = 100 if payload.choice == challenge["_direction"] else 0
    session.add(
        DailyChallengeAttempt(
            owner_id=owner,
            challenge_date=day,
            symbol=instrument.symbol,
            exchange=instrument.exchange,
            choice=payload.choice,
            start_price=challenge["_startPrice"],
            end_price=challenge["_endPrice"],
            score=score,
        )
    )
    await session.flush()
    return await _overview(session, owner, day)


@router.post("/journals", status_code=201)
async def create_journal(
    payload: JournalIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    item = await instrument_catalog.get(
        payload.symbol.upper(), exchange=payload.exchange.upper()
    )
    if not item:
        raise HTTPException(404, "기록할 종목을 찾을 수 없습니다.")
    count = await session.scalar(
        sa.select(sa.func.count()).where(TradeJournal.owner_id == owner)
    )
    if (count or 0) >= 500:
        raise HTTPException(409, "투자일지는 최대 500개까지 저장할 수 있습니다.")
    session.add(
        TradeJournal(
            owner_id=owner,
            symbol=item.symbol,
            exchange=item.exchange,
            thesis=payload.thesis.strip(),
            horizon=payload.horizon,
            target_return=payload.targetReturn,
            stop_loss=payload.stopLoss,
            confidence=payload.confidence,
        )
    )
    await session.flush()
    return await _overview(session, owner, datetime.now(SEOUL).date())


@router.patch("/journals/{journal_id}")
async def review_journal(
    journal_id: UUID,
    payload: JournalReviewIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await session.scalar(
        sa.select(TradeJournal).where(
            TradeJournal.id == journal_id,
            TradeJournal.owner_id == owner,
        )
    )
    if not row:
        raise HTTPException(404, "투자일지를 찾을 수 없습니다.")
    row.review = payload.review.strip()
    row.outcome = payload.outcome
    row.reviewed_at = datetime.now(UTC)
    return await _overview(session, owner, datetime.now(SEOUL).date())


@router.delete("/journals/{journal_id}")
async def delete_journal(
    journal_id: UUID,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await session.scalar(
        sa.select(TradeJournal).where(
            TradeJournal.id == journal_id,
            TradeJournal.owner_id == owner,
        )
    )
    if not row:
        raise HTTPException(404, "투자일지를 찾을 수 없습니다.")
    await session.delete(row)
    return {"removed": True}
