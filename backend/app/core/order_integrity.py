"""Deterministic helpers that protect write requests from accidental replay."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


def normalize_idempotency_key(value: str | None) -> str:
    """Validate a client-generated key without ever logging its raw value."""

    key = (value or "").strip()
    if not _IDEMPOTENCY_KEY.fullmatch(key):
        raise ValueError(
            "Idempotency-Key는 영문·숫자로 시작하는 8~128자 값이어야 합니다."
        )
    return key


def request_fingerprint(payload: dict[str, Any]) -> str:
    """Return a stable digest used to reject key reuse with another order."""

    canonical = json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
