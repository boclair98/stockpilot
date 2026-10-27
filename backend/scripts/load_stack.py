"""Disposable HTTP + PostgreSQL/Redis readiness test, NOT trading capacity.

Never use production environment or deploy this script. Runtime egress is
blocked by the dedicated internal Docker network in compose.capacity.yaml.
"""

import os
import sys
from pathlib import Path

from loadtest_guard import validate_environment

database, cache = validate_environment(os.environ)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import config  # noqa: E402

config.settings = config.Settings.model_construct(
    database_url=database,
    redis_url=cache,
    run_background_workers=False,
    auth_session_secret="isolated-load-only-not-a-production-session-secret",
)

if "--migrate" in sys.argv:
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config("alembic.ini"), "head")
    raise SystemExit(0)

from app.services.instrument_catalog import instrument_catalog  # noqa: E402


async def no_external_catalog():
    return None


instrument_catalog.ensure_loaded = no_external_catalog
if "--worker" in sys.argv:
    from app.worker import app

    port = 8001
else:
    from app.main import app

    port = 8000


@app.get("/__loadtest__/manifest")
async def manifest():
    return {
        "contract": "stockpilot-postgres-readiness-v1",
        "isolated": True,
        "database": "stockpilot_load",
        "redisDb": 15,
        "upstream": "disabled",
        "scope": "HTTP + PostgreSQL SELECT 1 + Redis startup; not financial or user capacity",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=port, access_log=False)
