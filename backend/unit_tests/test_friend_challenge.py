from decimal import Decimal

import pytest
from app.routes.league import RoomCreateIn, challenge_return_rate
from pydantic import ValidationError


def test_challenge_has_equal_bankroll_and_bounded_members():
    room = RoomCreateIn(name="친구 챌린지", nickname="파일럿", mode="CHALLENGE", durationDays=7, maxMembers=10)
    assert room.maxMembers == 10
    assert challenge_return_rate(Decimal("1000000")) == Decimal("0.0000")
    assert challenge_return_rate(Decimal("1050000")) == Decimal("5.0000")


@pytest.mark.parametrize("members", [2, 11])
def test_challenge_rejects_out_of_range_member_count(members):
    with pytest.raises(ValidationError):
        RoomCreateIn(name="친구 챌린지", nickname="파일럿", mode="CHALLENGE", durationDays=7, maxMembers=members)
