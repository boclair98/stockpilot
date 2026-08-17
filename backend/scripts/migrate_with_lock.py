"""Run Alembic once per database, even when several API pods boot together."""

from __future__ import annotations

import asyncio
import os
import subprocess

import asyncpg


ADVISORY_LOCK_KEY = 38_517_021


async def main() -> int:
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for migrations")
    # SQLAlchemy's asyncpg URL includes a dialect suffix that asyncpg itself
    # does not understand.
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    connection = await asyncpg.connect(database_url)
    try:
        # A session-scoped advisory lock makes concurrent container starts
        # serialize migrations without relying on a filesystem lock.
        await connection.execute(f"SELECT pg_advisory_lock({ADVISORY_LOCK_KEY})")
        result = subprocess.run(["uv", "run", "alembic", "upgrade", "head"], check=False)
        return result.returncode
    finally:
        await connection.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

