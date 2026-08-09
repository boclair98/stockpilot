from decimal import Decimal

import pytest
from app.core.order_integrity import normalize_idempotency_key, request_fingerprint

pytestmark = pytest.mark.no_db


@pytest.mark.parametrize(
    "value",
    [None, "", "short", "space is invalid", "한글-key-1234", "x" * 129],
)
def test_rejects_unsafe_idempotency_keys(value):
    with pytest.raises(ValueError):
        normalize_idempotency_key(value)


def test_accepts_uuid_and_keeps_it_stable():
    key = "a47b9db9-79dd-4b25-bc7a-8e27f7eefae8"
    assert normalize_idempotency_key(key) == key


def test_fingerprint_is_order_independent_and_payload_sensitive():
    first = request_fingerprint({"symbol": "005930", "quantity": Decimal("1.0")})
    same = request_fingerprint({"quantity": Decimal("1.0"), "symbol": "005930"})
    changed = request_fingerprint({"symbol": "005930", "quantity": Decimal("2.0")})
    assert first == same
    assert first != changed
