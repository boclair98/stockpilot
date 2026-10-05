"""Bounded, noncompetitive benefits; SDK callbacks are NOT signed receipts."""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException

TEST_REWARDED_GROUP = "ait-ad-test-rewarded-id"
TICKET_LIFETIME = timedelta(minutes=10)
RESET_COOLDOWN = timedelta(hours=1)
DAILY_LIMIT = 3


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def check_reward_ticket(ticket, owner, group: str, now: datetime) -> None:
    if ticket.owner_id != owner or ticket.ad_group_id != group:
        raise HTTPException(403, "광고 이용권을 확인할 수 없습니다.")
    # A redeemed ticket stays idempotently readable even after its expiry.
    if ticket.round_id is None and utc(ticket.expires_at) <= now:
        raise HTTPException(410, "광고 이용권이 만료됐어요. 다시 시작해 주세요.")


def check_reset_limits(
    last_reset: datetime | None, count_today: int, now: datetime
) -> None:
    if count_today >= DAILY_LIMIT:
        raise HTTPException(429, "새 연습 계좌는 하루 3번까지 만들 수 있어요.")
    if last_reset and now - utc(last_reset) < RESET_COOLDOWN:
        raise HTTPException(429, "새 연습 계좌는 1시간 뒤 다시 만들 수 있어요.")
