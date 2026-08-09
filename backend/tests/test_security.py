import pytest
from app.core.security import SECURITY_HEADERS, apply_security_headers
from starlette.datastructures import MutableHeaders

pytestmark = pytest.mark.no_db


def test_security_headers_are_applied_consistently():
    headers = MutableHeaders()
    apply_security_headers(headers)
    for name, value in SECURITY_HEADERS.items():
        assert headers[name] == value
    assert headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
