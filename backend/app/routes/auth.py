"""Google OAuth 2.0 authorization-code login for StockPilot."""

from __future__ import annotations

import re
import secrets
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, uuid5

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.identity import (
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    decode_signed,
    encode_session,
    encode_signed,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

STATE_COOKIE = "stockpilot_oauth_state"
STATE_MAX_AGE = 600
GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
TOSS_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{24,256}$")


class TossAnonymousSessionRequest(BaseModel):
    anonymous_key: str = Field(min_length=24, max_length=256)


def _ready() -> bool:
    return bool(
        settings.google_client_id
        and settings.google_client_secret
        and settings.auth_session_secret
    )


def _safe_return_to(value: str | None) -> str:
    if value and value.startswith("/") and not value.startswith("//"):
        return value
    return "/"


def _require_session_secret() -> None:
    if not settings.auth_session_secret:
        raise HTTPException(503, "Google 로그인이 아직 설정되지 않았습니다.")


def _oauth_redirect_uri(request: Request) -> str:
    """Return the callback URI for the current approved public hostname.

    The deployment is reachable through both the Coders.kr hostname and the
    user's custom domain. Google requires the redirect URI used during the
    code exchange to exactly match the one used during authorization, so the
    current host must be reflected consistently in both requests. We only do
    this for an explicit allow-list of hosts; otherwise we fall back to the
    configured URI and never trust an arbitrary Host header.
    """

    forwarded_host = request.headers.get("x-forwarded-host", "")
    host = (forwarded_host.split(",", 1)[0] or request.url.hostname or "").strip().lower()
    allowed_hosts = {
        item.strip().lower()
        for item in settings.google_allowed_hosts.split(",")
        if item.strip()
    }
    if host not in allowed_hosts:
        return settings.google_redirect_uri

    # Public traffic terminates TLS at the platform proxy. Preserve HTTP only
    # for local development so the production cookie remains Secure.
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    scheme = (forwarded_proto.split(",", 1)[0] or request.url.scheme).strip().lower()
    if host not in {"localhost", "127.0.0.1"}:
        scheme = "https"
    elif scheme not in {"http", "https"}:
        scheme = "http"
    return f"{scheme}://{host}/api/auth/google/callback"


@router.get("/status")
async def auth_status() -> dict:
    return {
        "provider": "google",
        "configured": _ready(),
        "tossAnonymousSession": bool(settings.auth_session_secret),
    }


@router.post("/toss/anonymous")
async def toss_anonymous_session(payload: TossAnonymousSessionRequest) -> JSONResponse:
    """Exchange the Apps in Toss anonymous user hash for an app session.

    The raw Toss hash is never persisted or returned. StockPilot derives a
    stable internal UUID and signs it with the same server-side secret used by
    the web session. The WebView then sends the token as an Authorization
    bearer because third-party cookie behavior differs between iOS and Android.
    """

    _require_session_secret()
    anonymous_key = payload.anonymous_key.strip()
    if not TOSS_KEY_PATTERN.fullmatch(anonymous_key):
        raise HTTPException(400, "앱인토스 사용자 식별키 형식이 올바르지 않습니다.")
    user_id = uuid5(
        NAMESPACE_URL,
        f"https://apps-in-toss.toss.im/anonymous/{anonymous_key}",
    )
    token = encode_signed(
        {
            "id": str(user_id),
            "name": f"toss-{str(user_id)[:8]}",
            "provider": "toss",
        },
        "toss-access",
    )
    return JSONResponse(
        {
            "access_token": token,
            "token_type": "bearer",
            "expires_in": SESSION_MAX_AGE,
        },
        headers={"Cache-Control": "no-store"},
    )


@router.get("/google/login")
async def google_login(
    request: Request,
    return_to: str = Query(default="/"),
) -> RedirectResponse:
    if not _ready():
        raise HTTPException(503, "Google 로그인이 아직 설정되지 않았습니다.")
    _require_session_secret()
    state = secrets.token_urlsafe(32)
    state_cookie = encode_signed(
        {"state": state, "return_to": _safe_return_to(return_to)}, "oauth-state"
    )
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _oauth_redirect_uri(request),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    response = RedirectResponse(f"{GOOGLE_AUTHORIZE}?{urlencode(params)}", 302)
    response.set_cookie(
        STATE_COOKIE,
        state_cookie,
        max_age=STATE_MAX_AGE,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/api/auth",
    )
    return response


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if error:
        return RedirectResponse("/?login=cancelled", 302)
    if not code or not state or not _ready():
        raise HTTPException(400, "Google 로그인 응답이 올바르지 않습니다.")
    state_payload = decode_signed(
        request.cookies.get(STATE_COOKIE), "oauth-state", STATE_MAX_AGE
    )
    if not state_payload:
        raise HTTPException(400, "로그인 요청이 만료되었습니다.") from None
    if not secrets.compare_digest(state, state_payload.get("state", "")):
        raise HTTPException(400, "로그인 요청을 확인할 수 없습니다.")

    async with httpx.AsyncClient(timeout=15) as client:
        token_response = await client.post(
            GOOGLE_TOKEN,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": _oauth_redirect_uri(request),
                "grant_type": "authorization_code",
            },
        )
        if not token_response.is_success:
            raise HTTPException(502, "Google 인증 토큰을 발급하지 못했습니다.")
        access_token = token_response.json().get("access_token")
        user_response = await client.get(
            GOOGLE_USERINFO,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if not user_response.is_success:
            raise HTTPException(502, "Google 사용자 정보를 확인하지 못했습니다.")
        profile = user_response.json()

    if not profile.get("sub") or not profile.get("email_verified"):
        raise HTTPException(403, "확인된 Google 이메일이 필요합니다.")
    user_id = uuid5(NAMESPACE_URL, f"https://accounts.google.com/{profile['sub']}")
    session = encode_session(
        {
            "id": str(user_id),
            "sub": profile["sub"],
            "name": profile.get("name") or profile.get("email", "").split("@")[0],
            "email": profile.get("email"),
            "picture": profile.get("picture"),
        }
    )
    response = RedirectResponse(_safe_return_to(state_payload.get("return_to")), 302)
    response.set_cookie(
        SESSION_COOKIE,
        session,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(STATE_COOKIE, path="/api/auth")
    return response


@router.post("/logout")
async def logout() -> RedirectResponse:
    response = RedirectResponse("/", 303)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
