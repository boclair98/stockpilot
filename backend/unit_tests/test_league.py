from decimal import Decimal

import pytest
from app.routes.league import RoomCreateIn, combined_return_rate
from pydantic import ValidationError


def test_initial_balances_start_at_zero_return() -> None:
    result = combined_return_rate(Decimal("100000000"), Decimal("100000"))
    assert result == Decimal("0")


def test_kr_and_us_wallets_are_equal_weighted() -> None:
    # KR +10%, US unchanged => combined league score +5%.
    result = combined_return_rate(Decimal("110000000"), Decimal("100000"))
    assert result == Decimal("5")


def test_wallet_losses_and_gains_are_combined_without_fx() -> None:
    # KR -10%, US +20% => combined league score +5%.
    result = combined_return_rate(Decimal("90000000"), Decimal("120000"))
    assert result == Decimal("5")


def test_duel_accepts_short_periods() -> None:
    room = RoomCreateIn(
        name="친구 대결",
        nickname="파일럿",
        durationDays=3,
        mode="DUEL",
    )
    assert room.durationDays == 3


def test_season_rejects_one_day_period() -> None:
    with pytest.raises(ValidationError):
        RoomCreateIn(
            name="시즌 리그",
            nickname="파일럿",
            durationDays=1,
            mode="SEASON",
        )
