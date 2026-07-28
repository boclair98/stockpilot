"""Google OAuth 2.0 authorization-code login for StockPilot."""

from __future__ import annotations

import secrets
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, uuid5

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

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


@router.get("/status")
async def auth_status() -> dict:
    return {"provider": "google", "configured": _ready()}


@router.get("/google/login")
async def google_login(
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
        "redirect_uri": settings.google_redirect_uri,
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
                "redirect_uri": settings.google_redirect_uri,
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
