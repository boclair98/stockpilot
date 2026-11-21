#!/bin/sh
set -e

# Coders can start Postgres and the API in parallel. This TCP probe is
# best-effort; migrations and startup still proceed after its deadline.
if [ -n "${DATABASE_URL:-}" ]; then
  python scripts/wait_for_database.py
fi

if [ "${RUN_MIGRATIONS_ON_BOOT:-false}" = "true" ]; then
  uv run python scripts/migrate_with_lock.py
fi

if [ "${BOOTSTRAP_SCHEMA_REVISION:-}" = "0017_toss_practice_rewards" ]; then
  uv run python scripts/migrate_practice_once.py
fi

if [ "${BOOTSTRAP_SCHEMA_REVISION:-}" = "0018_personal_tools" ]; then
  uv run python scripts/migrate_personal_once.py
fi

exec uv run uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
