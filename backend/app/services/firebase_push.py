"""Small, server-only Firebase Cloud Messaging adapter."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from dataclasses import dataclass

import firebase_admin
from firebase_admin import credentials, messaging

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PushResult:
    success_count: int
    invalid_tokens: tuple[str, ...]


def is_permanent_token_error(error: Exception | None) -> bool:
    if error is None:
        return False
    value = str(error).lower()
    return any(
        marker in value
        for marker in (
            "registration-token-not-registered",
            "invalid-registration-token",
            "requested entity was not found",
            "sender id mismatch",
        )
    )


class FirebasePush:
    def __init__(self) -> None:
        self._app: firebase_admin.App | None = None
        self._init_attempted = False

    @property
    def configured(self) -> bool:
        return bool(settings.firebase_service_account_b64)

    def _initialize(self) -> firebase_admin.App | None:
        if self._app:
            return self._app
        if self._init_attempted or not self.configured:
            return None
        self._init_attempted = True
        try:
            raw = base64.b64decode(
                settings.firebase_service_account_b64 or "", validate=True
            )
            service_account = json.loads(raw)
            if (
                service_account.get("type") != "service_account"
                or not service_account.get("project_id")
                or not service_account.get("private_key")
            ):
                raise ValueError("invalid Firebase service account")
            self._app = firebase_admin.initialize_app(
                credentials.Certificate(service_account),
                name="stockpilot-push",
            )
            return self._app
        except Exception:
            logger.exception("Firebase Cloud Messaging initialization failed")
            return None

    async def send(
        self,
        tokens: list[str],
        *,
        title: str,
        body: str,
        data: dict[str, str],
    ) -> PushResult:
        app = self._initialize()
        if not app or not tokens:
            return PushResult(0, ())

        payload = {**data, "title": title, "body": body}
        message = messaging.MulticastMessage(
            tokens=tokens[:500],
            data=payload,
            webpush=messaging.WebpushConfig(
                headers={"Urgency": "high", "TTL": "300"},
                fcm_options=messaging.WebpushFCMOptions(
                    link=data.get("url", "https://stockpilot.coders.kr/")
                ),
            ),
        )

        try:
            response = await asyncio.to_thread(
                messaging.send_each_for_multicast,
                message,
                False,
                app,
            )
        except Exception:
            logger.exception("Firebase Cloud Messaging send failed")
            return PushResult(0, ())

        invalid = tuple(
            token
            for token, result in zip(tokens, response.responses, strict=False)
            if not result.success and is_permanent_token_error(result.exception)
        )
        return PushResult(response.success_count, invalid)


firebase_push = FirebasePush()
