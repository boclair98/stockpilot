"""Only 0017 -> 0018 under the existing PostgreSQL advisory migration lock."""
import asyncio
import os
import subprocess

import asyncpg

TARGET = "0018_personal_tools"
PARENT = "0017_toss_practice_rewards"


def migration_action(revisions):
    if revisions == [TARGET]:
        return "skip"
    if revisions == [PARENT]:
        return "upgrade"
    raise RuntimeError("Unexpected schema revision; no migration attempted")


async def main():
    if os.getenv("BOOTSTRAP_SCHEMA_REVISION") != TARGET:
        return 0
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://", 1)
    connection = await asyncpg.connect(url, timeout=5)
    try:
        for _ in range(30):
            if await connection.fetchval("SELECT pg_try_advisory_lock($1)", 38_517_021):
                break
            await asyncio.sleep(1)
        else:
            raise RuntimeError("Migration lock is busy")
        revisions = [row["version_num"] for row in await connection.fetch("SELECT version_num FROM alembic_version")]
        if migration_action(revisions) == "skip":
            print("Personal tools schema ready; skipped")
            return 0
        result = subprocess.run(["uv", "run", "alembic", "upgrade", TARGET], timeout=90, check=False)
        return result.returncode
    finally:
        await connection.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
