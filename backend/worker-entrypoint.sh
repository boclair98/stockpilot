#!/bin/sh
set -e

# Workers do not run schema migrations. Apply migrations once before a
# rollout, then let every worker start immediately and use readiness checks.
exec uv run uvicorn app.worker:app --host 0.0.0.0 --port "${PORT:-8001}"

