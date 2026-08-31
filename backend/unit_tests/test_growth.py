from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from app.routes.growth import (
    _financial_safety_report,
    _investment_license,
    _skill_scores,
    _streak,
)


def test_streak_counts_back_from_today() -> None:
    today = date(2026, 8, 2)
    assert _streak([today, today - timedelta(days=1)], today) == 2


def test_streak_keeps_yesterday_when_today_not_answered() -> None:
    today = date(2026, 8, 2)
    assert (
        _streak(
            [today - timedelta(days=1), today - timedelta(days=2)],
            today,
        )
        == 2
    )


def test_skill_score_rewards_planning_and_review() -> None:
    history = [
        SimpleNamespace(return_rate=Decimal("0")),
        SimpleNamespace(return_rate=Decimal("1")),
    ]
    journals = [
        SimpleNamespace(
            target_return=Decimal("10"),
            stop_loss=Decimal("-5"),
            reviewed_at=object(),
        )
    ]
    result = _skill_scores(Decimal("1"), history, 5, journals)
    assert result["overall"] > 50
    assert result["discipline"] > 30
    assert result["maxDrawdown"] == 0


def test_investment_license_uses_verified_behavior_for_progress() -> None:
    result = _investment_license(
        challenge_count=3,
        filled_order_count=6,
        journal_count=3,
        planned_journal_count=2,
        reviewed_journal_count=3,
        protection_count=1,
        distinct_instrument_count=3,
        snapshot_count=5,
        streak=3,
        risk_score=82,
    )

    assert result["completedMissions"] == 9
    assert result["totalMissions"] == 12
    assert result["tier"] == "원칙 운용사"
    assert result["currentStage"] == "PORTFOLIO_MASTER"
    assert result["nextMission"]["key"] == "seven-snapshots"


def test_investment_license_keeps_risk_mission_locked_until_five_orders() -> None:
    result = _investment_license(
        challenge_count=1,
        filled_order_count=2,
        journal_count=1,
        planned_journal_count=1,
        reviewed_journal_count=3,
        protection_count=1,
        distinct_instrument_count=3,
        snapshot_count=7,
        streak=3,
        risk_score=100,
    )

    risk_mission = next(
        mission
        for stage in result["stages"]
        for mission in stage["missions"]
        if mission["key"] == "risk-score"
    )
    assert risk_mission["completed"] is False
    assert risk_mission["current"] == 0


def test_financial_safety_rewards_protective_habits() -> None:
    result = _financial_safety_report(
        filled_order_count=8,
        weekly_order_count=7,
        planned_journal_count=3,
        reviewed_journal_count=3,
        protection_count=1,
        distinct_instrument_count=5,
        streak=5,
        risk_score=86,
    )

    assert result["score"] == 99
    assert result["grade"] == "우수"
    assert result["status"] == "EXCELLENT"
    assert len(result["indicators"]) == 5


def test_financial_safety_does_not_reward_inactivity_or_overtrading() -> None:
    inactive = _financial_safety_report(
        filled_order_count=0,
        weekly_order_count=0,
        planned_journal_count=0,
        reviewed_journal_count=0,
        protection_count=0,
        distinct_instrument_count=0,
        streak=0,
        risk_score=100,
    )
    overtrading = _financial_safety_report(
        filled_order_count=50,
        weekly_order_count=50,
        planned_journal_count=0,
        reviewed_journal_count=0,
        protection_count=0,
        distinct_instrument_count=1,
        streak=0,
        risk_score=30,
    )

    assert inactive["score"] == 0
    assert overtrading["score"] == 8
    assert overtrading["indicators"][-1]["score"] == 1
