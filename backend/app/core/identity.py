"""Google-backed application identity.

StockPilot is deployed in coders.kr ``standalone`` mode. Authentication is
therefore handled by the app itself and never trusts a caller-supplied header.
The browser receives only a signed, HttpOnly session cookie.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, Request

from app.core.config import settings

SESSION_COOKIE = "stockpilot_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30


@dataclass(frozen=True)
class Identity:
    id: UUID
    google_sub: str | None
    display_name: str | None
    email: str | None
    picture: str | None


def encode_signed(payload: dict, salt: str) -> str:
    if not settings.auth_session_secret:
        raise RuntimeError("AUTH_SESSION_SECRET is not configured")
    value = {**payload, "iat": int(time.time())}
    encoded = base64.urlsafe_b64encode(
        json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    ).decode().rstrip("=")
    signature = hmac.new(
        settings.auth_session_secret.encode(),
        f"{salt}.{encoded}".encode(),
        hashlib.sha256,
    ).digest()
    return f"{encoded}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def decode_signed(value: str | None, salt: str, max_age: int) -> dict | None:
    if not value or not settings.auth_session_secret or "." not in value:
        return None
    encoded, signature = value.rsplit(".", 1)
    expected = hmac.new(
        settings.auth_session_secret.encode(),
        f"{salt}.{encoded}".encode(),
        hashlib.sha256,
    ).digest()
    try:
        actual = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(actual, expected):
            return None
        payload = json.loads(
            base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        )
        issued_at = int(payload.pop("iat"))
        if issued_at > time.time() + 60 or time.time() - issued_at > max_age:
            return None
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def encode_session(payload: dict) -> str:
    return encode_signed(payload, "session")


def decode_session(value: str | None) -> Identity | None:
    payload = decode_signed(value, "session", SESSION_MAX_AGE)
    if not payload:
        return None
    try:
        return Identity(
            id=UUID(payload["id"]),
            google_sub=payload.get("sub"),
            display_name=payload.get("name"),
            email=payload.get("email"),
            picture=payload.get("picture"),
        )
    except (KeyError, TypeError, ValueError):
        return None


def current_identity(request: Request) -> Identity | None:
    identity = decode_session(request.cookies.get(SESSION_COOKIE))
    if identity:
        return identity
    if settings.dev_fake_user:
        try:
            return Identity(UUID(settings.dev_fake_user), None, "개발 사용자", None, None)
        except ValueError:
            pass
    return None


async def optional_identity(request: Request) -> UUID | None:
    identity = current_identity(request)
    return identity.id if identity else None


async def optional_display_name(request: Request) -> str | None:
    identity = current_identity(request)
    return identity.display_name if identity else None


async def require_identity(request: Request) -> UUID:
    identity = current_identity(request)
    if not identity:
        raise HTTPException(status_code=401, detail="Google 로그인이 필요합니다.")
    return identity.id
