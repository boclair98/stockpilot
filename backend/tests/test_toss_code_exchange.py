from __future__ import annotations

import json
from uuid import NAMESPACE_URL, uuid5

import httpx
import pytest
from app.core.config import settings
from app.core.identity import current_identity, decode_signed, encode_signed
from app.main import app
from app.routes.auth import TossAuthCodeRequest, toss_code_session
from app.services import toss_auth
from fastapi import HTTPException
from starlette.requests import Request

pytestmark = [pytest.mark.no_db, pytest.mark.asyncio]
KEY = "server-issued-anonymous-key-1234567890"


def install_partner(monkeypatch, body, status=200):
    calls = []

    async def handler(request):
        calls.append(request)
        return httpx.Response(status, json=body)

    monkeypatch.setattr(
        toss_auth,
        "_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return calls


async def test_success_consumes_native_code_and_preserves_existing_user_id(monkeypatch):
    monkeypatch.setattr(settings, "auth_session_secret", "test-only-secret-1234567890")
    calls = install_partner(
        monkeypatch, {"resultType": "SUCCESS", "success": {"anonKey": KEY}}
    )
    response = await toss_code_session(TossAuthCodeRequest(code="one-use-native-code"))
    body = json.loads(response.body)
    payload = decode_signed(body["access_token"], "toss-access", 3600)
    assert payload["id"] == str(
        uuid5(NAMESPACE_URL, f"https://apps-in-toss.toss.im/anonymous/{KEY}")
    )
    assert payload["auth_method"] == "code_exchange"
    assert len(calls) == 1
    assert str(calls[0].url) == toss_auth.EXCHANGE_URL
    assert calls[0].method == "POST"
    assert json.loads(calls[0].content) == {"code": "one-use-native-code"}
    assert KEY not in response.body.decode()
    assert "one-use-native-code" not in response.body.decode()
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "body,status,expected",
    [
        ({"resultType": "FAIL", "error": {"errorCode": "4011"}}, 200, 401),
        ({"resultType": "FAIL", "error": {"errorCode": 4095}}, 200, 429),
        ({"resultType": "FAIL", "success": {"anonKey": KEY}}, 200, 502),
        ({"resultType": "HTTP_TIMEOUT"}, 200, 502),
        ({"resultType": "SUCCESS", "success": None}, 200, 502),
        ({"resultType": "SUCCESS", "success": {"anonKey": "bad"}}, 200, 502),
        ({"resultType": "SUCCESS", "success": {"anonKey": KEY}}, 500, 502),
        ({}, 429, 429),
        ([], 200, 502),
    ],
)
async def test_partner_failure_is_not_login_and_never_retried(
    monkeypatch, body, status, expected
):
    calls = install_partner(monkeypatch, body, status)
    with pytest.raises(HTTPException) as error:
        await toss_auth.exchange_anonymous_code("one-use-native-code")
    assert error.value.status_code == expected
    assert len(calls) == 1
    assert KEY not in str(error.value.detail)


async def test_missing_cert_fails_closed(monkeypatch):
    monkeypatch.setattr(settings, "toss_mtls_cert_path", None)
    monkeypatch.setattr(settings, "toss_mtls_key_path", None)
    monkeypatch.setattr(settings, "toss_mtls_cert_b64", None)
    monkeypatch.setattr(settings, "toss_mtls_key_b64", None)
    with pytest.raises(HTTPException) as error:
        await toss_auth.exchange_anonymous_code("native-code")
    assert error.value.status_code == 503


async def test_validation_never_reflects_native_code():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://stockpilot.coders.kr"
    ) as client:
        response = await client.post(
            "/api/auth/toss/exchange", json={"code": "private invalid native code"}
        )
    assert response.status_code == 422
    assert "private invalid" not in response.text
    assert "input" not in response.text


async def test_timeout_is_bounded_and_does_not_retry(monkeypatch):
    calls = []

    async def handler(request):
        calls.append(request)
        raise httpx.ReadTimeout("unit test timeout")

    monkeypatch.setattr(
        toss_auth, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    with pytest.raises(HTTPException) as error:
        await toss_auth.exchange_anonymous_code("native-code")
    assert error.value.status_code == 504
    assert len(calls) == 1


async def test_secure_cutover_rejects_legacy_token_without_deleting_accounts(monkeypatch):
    monkeypatch.setattr(settings, "auth_session_secret", "test-only-secret-1234567890")
    monkeypatch.setattr(settings, "toss_secure_auth_required", True)
    monkeypatch.setattr(settings, "dev_fake_user", None)
    user_id = str(uuid5(NAMESPACE_URL, "same-existing-user"))
    for method, expected in [("legacy_hash", False), ("code_exchange", True)]:
        token = encode_signed(
            {"id": user_id, "provider": "toss", "auth_method": method}, "toss-access"
        )
        request = Request(
            {"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]}
        )
        identity = current_identity(request)
        assert bool(identity) == expected
        if identity:
            assert str(identity.id) == user_id
