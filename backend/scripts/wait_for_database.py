"""Best-effort TCP readiness check for the Postgres service on API startup."""

import os
import socket
import sys
import threading
import time
from urllib.parse import urlsplit


def database_address(url: str) -> tuple[str, int] | None:
    """Read just the server address, without exposing or decoding credentials."""
    try:
        parts = urlsplit(url)
        if parts.scheme.partition("+")[0] not in {"postgresql", "postgres"}:
            return None
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if not host or port == 0 or any(char.isspace() or char == "\0" for char in host):
        return None
    return host, 5432 if port is None else port


def wait_for_database(host: str, port: int, timeout: float = 60.0) -> bool:
    deadline = time.monotonic() + timeout
    stopped = threading.Event()
    connected = threading.Event()

    def probe() -> None:
        while not stopped.is_set():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            try:
                with socket.create_connection(
                    (host, port), timeout=min(1.0, remaining)
                ):
                    if not stopped.is_set():
                        connected.set()
                return
            except (OSError, UnicodeError):
                stopped.wait(max(0.0, min(1.0, deadline - time.monotonic())))

    # Socket timeouts do not govern DNS resolution or all address attempts
    # collectively. Keep one probe in flight and cap the caller's total wait.
    worker = threading.Thread(target=probe, daemon=True)
    worker.start()
    worker.join(max(0.0, deadline - time.monotonic()))
    stopped.set()
    return connected.is_set()


def main() -> None:
    address = database_address(os.environ.get("DATABASE_URL", ""))
    if address and not wait_for_database(*address):
        print(
            "Database TCP readiness check timed out; continuing API startup.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
