from __future__ import annotations

import json
from uuid import UUID

import pytest
from app.core.config import settings
from app.core.identity import current_identity
from app.main import app
from app.routes.auth import TossAnonymousSessionRequest, toss_anonymous_session
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request


def bearer_request(token: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/users/me",
            "headers": [(b"authorization", f"Bearer {token}".encode())],
            "query_string": b"",
            "server": ("test", 80),
            "client": ("127.0.0.1", 12345),
            "scheme": "http",
        }
    )


@pytest.mark.asyncio
async def test_toss_anonymous_exchange_creates_stable_bearer_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        settings, "auth_session_secret", "test-only-session-secret-at-least-32-bytes"
    )
    payload = TossAnonymousSessionRequest(
        anonymous_key="hash_value-1234567890-abcdef"
    )

    first = await toss_anonymous_session(payload)
    second = await toss_anonymous_session(payload)
    first_body = json.loads(first.body)
    second_body = json.loads(second.body)

    assert first_body["token_type"] == "bearer"
    first_identity = current_identity(bearer_request(first_body["access_token"]))
    second_identity = current_identity(bearer_request(second_body["access_token"]))
    assert first_identity is not None
    assert second_identity is not None
    assert isinstance(first_identity.id, UUID)
    assert first_identity.id == second_identity.id
    assert first_identity.provider == "toss"
    assert first_identity.email is None


@pytest.mark.asyncio
async def test_toss_anonymous_exchange_rejects_untrusted_key_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        settings, "auth_session_secret", "test-only-session-secret-at-least-32-bytes"
    )
    with pytest.raises(HTTPException) as error:
        await toss_anonymous_session(
            TossAnonymousSessionRequest(
                anonymous_key="invalid key with spaces 1234567890"
            )
        )
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_toss_origin_preflight_allows_order_headers() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://stockpilot.coders.kr") as client:
        response = await client.options(
            "/api/trading/orders",
            headers={
                "Origin": "https://stockpilot-kr.web.tossmini.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": (
                    "authorization,content-type,idempotency-key"
                ),
            },
        )

    assert response.status_code == 200
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "content-type" in allowed_headers
    assert "idempotency-key" in allowed_headers
