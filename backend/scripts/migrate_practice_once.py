"""Approved single revision only. General boot migrations remain disabled.

On repeated boots/replicas, DB revision 0017 skips Alembic entirely. Refuse
unknown/multiple heads instead of silently upgrading other schema revisions.
The temporary BOOTSTRAP_SCHEMA_REVISION opt-in is removed after deployment.
"""

import asyncio
import os
import subprocess

import asyncpg

EXPECTED_PARENT = "0016_friend_challenge"
TARGET = "0017_toss_practice_rewards"
ADVISORY_LOCK_KEY = 38_517_021  # Same namespace as the existing migration runner.


def migration_action(revisions: list[str]) -> str:
    if revisions == [TARGET]:
        return "skip"
    if revisions == [EXPECTED_PARENT]:
        return "upgrade"
    raise RuntimeError("Unexpected schema revision; refused to change the database")


async def main() -> int:
    if os.getenv("BOOTSTRAP_SCHEMA_REVISION") != TARGET:
        return 0
    database_url = os.getenv("DATABASE_URL", "").replace(
        "postgresql+asyncpg://", "postgresql://", 1
    )
    if not database_url:
        raise RuntimeError("Database configuration is missing")
    connection = await asyncpg.connect(database_url, timeout=5)
    try:
        for _attempt in range(30):
            if await connection.fetchval(
                "SELECT pg_try_advisory_lock($1)", ADVISORY_LOCK_KEY
            ):
                break
            await asyncio.sleep(1)
        else:
            raise RuntimeError("Migration lock is busy; no schema change attempted")
        revisions = [
            row["version_num"]
            for row in await connection.fetch("SELECT version_num FROM alembic_version")
        ]
        if migration_action(revisions) == "skip":
            print("Practice schema already ready; migration skipped")
            return 0
        # Pinned target, not 'head'. Only the approved additive migration runs.
        result = subprocess.run(
            ["uv", "run", "alembic", "upgrade", TARGET], check=False, timeout=90
        )
        return result.returncode
    finally:
        await connection.close()  # Also releases the session advisory lock.


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
