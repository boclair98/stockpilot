"""Stable, bounded inbox pagination across independent event tables."""

import base64
import binascii
import json
from datetime import datetime
from uuid import UUID

import sqlalchemy as sa
from fastapi import HTTPException

from app.services.personal_math import aware

KINDS = {"order", "price", "money", "recurring", "support"}


def decode_cursor(value: str | None):
    if value is None:
        return None
    try:
        data = json.loads(base64.b64decode(value, altchars=b"-_", validate=True))
        if (
            not isinstance(data, list)
            or len(data) != 4
            or data[0] != 1
            or not all(isinstance(part, str) for part in data[1:])
        ):
            raise ValueError
        at = datetime.fromisoformat(data[1])
        if at.tzinfo is None or data[2] not in KINDS:
            raise ValueError
        return aware(at), data[2], UUID(data[3])
    except (ValueError, TypeError, KeyError, binascii.Error, UnicodeError) as exc:
        raise HTTPException(
            422, "알림 조회 위치가 올바르지 않아요. 최신 알림부터 다시 조회해 주세요."
        ) from exc


def encode_cursor(event):
    kind, identity, *_ = event["key"].split(":")
    data = [1, event["at"], kind, identity]
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def event_order(event):
    kind, identity, *_ = event["key"].split(":")
    return aware(datetime.fromisoformat(event["at"])), kind, UUID(identity).int


def page_boundary(date, identity, kind, end, cursor):
    if cursor is None:
        return date < end
    at, cursor_kind, cursor_id = cursor
    if kind < cursor_kind:
        tie = sa.true()
    elif kind > cursor_kind:
        tie = sa.false()
    else:
        tie = identity < cursor_id
    return sa.or_(date < at, sa.and_(date == at, tie))
