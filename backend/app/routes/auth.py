"""Google OAuth for the public web and Toss Login sessions for the mini-app."""

from __future__ import annotations

import secrets
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, uuid5

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.core.identity import (
    AIT_ACCESS_TOKEN_SALT,
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


class TossLoginExchange(BaseModel):
    authorizationCode: str = Field(min_length=1, max_length=4096)
    referrer: str = Field(pattern="^(DEFAULT|SANDBOX)$")


class TossAnonymousSession(BaseModel):
    hash: str = Field(min_length=16, max_length=4096)

    @field_validator("hash")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if value != value.strip() or any(character.isspace() for character in value):
            raise ValueError("invalid anonymous key")
        return value


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
        "tossLoginConfigured": bool(
            settings.toss_login_enabled
            and settings.toss_client_cert_path
            and settings.toss_client_key_path
            and settings.auth_session_secret
        ),
    }


def _toss_ready() -> bool:
    return bool(
        settings.toss_login_enabled
        and settings.toss_client_cert_path
        and settings.toss_client_key_path
        and settings.auth_session_secret
    )


async def _toss_client() -> httpx.AsyncClient:
    if not _toss_ready():
        raise HTTPException(503, "토스 로그인이 아직 설정되지 않았습니다.")
    return httpx.AsyncClient(
        base_url=settings.toss_api_base_url.rstrip("/"),
        cert=(settings.toss_client_cert_path, settings.toss_client_key_path),
        timeout=15,
    )


@router.post("/toss/exchange")
async def toss_exchange(payload: TossLoginExchange, request: Request) -> dict:
    """Exchange the one-time mini-app authorization code on the server.

    Access/refresh tokens never reach the browser. Only the app-scoped
    ``userKey`` is retained in the signed session, which is then mapped to a
    stable app-local UUID so the existing API and virtual ledger can be used
    without exposing personal data. Toss and Google identities remain
    separate accounts unless an explicit account-linking flow is added later.
    """

    client = await _toss_client()
    try:
        token_response = await client.post(
            "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
            json={
                "authorizationCode": payload.authorizationCode,
                "referrer": payload.referrer,
            },
        )
        if not token_response.is_success:
            raise HTTPException(502, "토스 인증 토큰을 발급하지 못했어요.")
        token_payload = token_response.json()
        if token_payload.get("resultType") != "SUCCESS":
            raise HTTPException(502, "토스 인증 토큰을 발급하지 못했어요.")
        access_token = token_payload.get("success", {}).get("accessToken")
        if not access_token:
            raise HTTPException(502, "토스 인증 토큰 응답이 올바르지 않아요.")

        profile_response = await client.get(
            "/api-partner/v1/apps-in-toss/user/oauth2/login-me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if not profile_response.is_success:
            raise HTTPException(502, "토스 사용자 정보를 확인하지 못했어요.")
        profile_payload = profile_response.json()
        if profile_payload.get("resultType") != "SUCCESS":
            raise HTTPException(502, "토스 사용자 정보를 확인하지 못했어요.")
        profile = profile_payload.get("success") or {}
        user_key = profile.get("userKey")
        if not isinstance(user_key, int):
            raise HTTPException(502, "토스 사용자 식별자를 받지 못했어요.")
    except httpx.HTTPError as exc:
        raise HTTPException(502, "토스 사용자 인증을 확인하지 못했어요.") from exc
    finally:
        await client.aclose()

    user_id = uuid5(
        NAMESPACE_URL,
        f"https://apps-in-toss.toss.im/{settings.toss_app_name}/{user_key}",
    )
    session = encode_session(
        {
            "id": str(user_id),
            "name": f"user-{user_key}",
            "provider": "toss",
            "toss_user_key": user_key,
        }
    )
    response = JSONResponse({"ok": True, "provider": "toss"})
    # The mini-app and the shared API have different HTTPS origins. `None` is
    # required for credentialed cross-origin fetches from the Toss WebView.
    response.set_cookie(
        SESSION_COOKIE,
        session,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    return response


@router.post("/toss/anonymous")
async def toss_anonymous_session(payload: TossAnonymousSession) -> dict:
    """Create a stable app-local session from Apps in Toss' anonymous key.

    The raw key is never stored in the cookie or database. It is namespaced to
    this mini-app and converted into the UUID already used by StockPilot's
    virtual ledger, keeping the public Google identity completely separate.
    """

    user_id = uuid5(
        NAMESPACE_URL,
        f"https://apps-in-toss.toss.im/{settings.toss_app_name}/anonymous/{payload.hash}",
    )
    access_token = encode_signed(
        {
            "id": str(user_id),
            "provider": "toss_anonymous",
        },
        AIT_ACCESS_TOKEN_SALT,
    )
    # iOS blocks third-party cookies in the Toss WebView. Return a signed
    # bearer token and keep it in app memory; never depend on Set-Cookie here.
    return {
        "ok": True,
        "provider": "toss_anonymous",
        "accessToken": access_token,
        "expiresIn": SESSION_MAX_AGE,
    }


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
async def logout() -> JSONResponse:
    # Return JSON rather than a cross-origin redirect so the Apps in Toss
    # WebView can complete the credentialed fetch cleanly.
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response

