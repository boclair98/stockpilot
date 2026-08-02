from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from app.routes.growth import _skill_scores, _streak


def test_streak_counts_back_from_today() -> None:
    today = date(2026, 8, 2)
    assert _streak([today, today - timedelta(days=1)], today) == 2


def test_streak_keeps_yesterday_when_today_not_answered() -> None:
    today = date(2026, 8, 2)
    assert _streak(
        [today - timedelta(days=1), today - timedelta(days=2)],
        today,
    ) == 2


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
