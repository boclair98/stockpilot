"""Verified Apps in Toss anonymous sign-in. No raw partner data is logged."""

from __future__ import annotations

import base64
import binascii
import re
import ssl
import tempfile
from pathlib import Path

import httpx
from fastapi import HTTPException

from app.core.config import settings

EXCHANGE_URL = (
    "https://apps-in-toss-api.toss.im"
    "/api-partner/v1/apps-in-toss/users/anon-key/exchange"
)
ANON_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{24,256}$")


def exchange_ready() -> bool:
    return bool(
        (settings.toss_mtls_cert_path and settings.toss_mtls_key_path)
        or (settings.toss_mtls_cert_b64 and settings.toss_mtls_key_b64)
    )


def _client() -> httpx.AsyncClient:
    if not exchange_ready():
        raise HTTPException(503, "앱 계정 연결을 준비 중이에요. 잠시 후 다시 열어 주세요.")
    context = ssl.create_default_context()
    try:
        if settings.toss_mtls_cert_path and settings.toss_mtls_key_path:
            context.load_cert_chain(
                settings.toss_mtls_cert_path, settings.toss_mtls_key_path
            )
        else:
            # TemporaryDirectory is private (0700) on the Linux deployment.
            # SSLContext loads the key into memory before the files disappear.
            with tempfile.TemporaryDirectory(prefix="stockpilot-mtls-") as directory:
                cert = Path(directory) / "client.crt"
                key = Path(directory) / "client.key"
                for target, secret in [
                    (cert, settings.toss_mtls_cert_b64),
                    (key, settings.toss_mtls_key_b64),
                ]:
                    value = secret.get_secret_value()
                    if len(value) > 64_000:
                        raise ValueError("certificate exceeds size limit")
                    target.write_bytes(base64.b64decode(value, validate=True))
                    target.chmod(0o600)
                context.load_cert_chain(cert, key)
    except (OSError, ssl.SSLError, ValueError, binascii.Error, AttributeError):
        # Certificate paths, key contents and partner error bodies are private.
        raise HTTPException(503, "앱 계정 연결을 점검하고 있어요.") from None
    return httpx.AsyncClient(
        verify=context,
        timeout=httpx.Timeout(8.0, connect=4.0),
        follow_redirects=False,
        trust_env=False,
    )


async def exchange_anonymous_code(code: str) -> str:
    """Consume a one-use native code once. Never retry or accept a raw hash."""
    try:
        async with _client() as client:
            response = await client.post(EXCHANGE_URL, json={"code": code})
    except httpx.TimeoutException:
        raise HTTPException(504, "계정 연결 확인이 지연돼요. 앱에서 다시 연결해 주세요.") from None
    except httpx.HTTPError:
        raise HTTPException(503, "계정 연결에 실패했어요. 잠시 후 다시 시도해 주세요.") from None
    if response.status_code == 429:
        raise HTTPException(429, "계정 연결 요청이 많아요. 잠시 후 다시 시도해 주세요.")
    if response.status_code != 200:
        raise HTTPException(502, "계정 연결을 확인하지 못했어요. 다시 시도해 주세요.")
    try:
        body = response.json()
    except ValueError:
        raise HTTPException(502, "계정 연결 응답을 확인하지 못했어요.") from None
    if not isinstance(body, dict) or body.get("resultType") != "SUCCESS":
        error = body.get("error") if isinstance(body, dict) else None
        error_code = str(error.get("errorCode")) if isinstance(error, dict) else ""
        if error_code == "4095":
            raise HTTPException(429, "계정 연결 요청이 많아요. 잠시 후 다시 시도해 주세요.")
        if error_code == "4011":
            raise HTTPException(401, "연결 시간이 지났어요. 앱에서 다시 연결해 주세요.")
        raise HTTPException(502, "계정 연결을 완료하지 못했어요. 다시 시도해 주세요.")
    data = body.get("success")
    key = data.get("anonKey") if isinstance(data, dict) else None
    if not isinstance(key, str) or not ANON_KEY_PATTERN.fullmatch(key):
        raise HTTPException(502, "계정 연결 응답을 확인하지 못했어요.")
    return key
