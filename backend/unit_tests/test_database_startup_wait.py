import socket
import threading
import time

import pytest
from scripts import wait_for_database as startup


@pytest.mark.parametrize(
    ("url", "address"),
    [
        ("postgresql://db/stockpilot", ("db", 5432)),
        ("postgres://reader:pass@db:25432/stockpilot", ("db", 25432)),
        ("postgresql+asyncpg://user:p%40ss@[::1]:6432/db", ("::1", 6432)),
        ("postgresql+asyncpg://[2001:db8::1]/db", ("2001:db8::1", 5432)),
        ("postgresql:///stockpilot", None),
        ("postgresql://db:0/stockpilot", None),
        ("postgresql://db:not_a_port/stockpilot", None),
        ("postgresql://[::1/stockpilot", None),
        ("sqlite+aiosqlite:///stockpilot", None),
        ("", None),
    ],
)
def test_database_address(url, address) -> None:
    assert startup.database_address(url) == address


def test_listening_postgres_port_does_not_delay_startup() -> None:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        host, port = listener.getsockname()
        assert startup.wait_for_database(host, port, timeout=1)


def test_unavailable_postgres_respects_deadline(monkeypatch) -> None:
    def refused(*_args, **_kwargs):
        raise ConnectionRefusedError

    monkeypatch.setattr(socket, "create_connection", refused)
    start = time.monotonic()
    assert not startup.wait_for_database("db.invalid", 5432, timeout=0.05)
    assert time.monotonic() - start < 0.5


def test_stalled_resolution_does_not_hold_api_startup(monkeypatch) -> None:
    started = threading.Event()
    release = threading.Event()

    def stalled(*_args, **_kwargs):
        started.set()
        release.wait(2)
        raise OSError

    monkeypatch.setattr(socket, "create_connection", stalled)
    try:
        start = time.monotonic()
        assert not startup.wait_for_database("db.invalid", 5432, timeout=0.05)
        assert started.is_set()
        assert time.monotonic() - start < 0.5
    finally:
        release.set()


def test_timeout_does_not_log_connection_url_or_credentials(
    monkeypatch, capsys
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://reader:secret@db.internal/data")
    monkeypatch.setattr(startup, "wait_for_database", lambda *_: False)
    startup.main()
    assert capsys.readouterr().err == (
        "Database TCP readiness check timed out; continuing API startup.\n"
    )
