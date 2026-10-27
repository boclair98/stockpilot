"""Safety boundary for disposable PostgreSQL/Redis test containers only."""

from urllib.parse import urlsplit


def validate_environment(env):
    if env.get("STOCKPILOT_CAPACITY_FIXTURE") != "1":
        raise ValueError("Explicit isolated capacity fixture opt-in required")
    database = env.get("DATABASE_URL", "")
    db = urlsplit(database)
    cache = urlsplit(env.get("REDIS_URL", ""))
    if (
        db.scheme != "postgresql+asyncpg"
        or db.hostname not in {"db", "localhost", "127.0.0.1"}
        or db.path != "/stockpilot_load"
        or db.query
        or db.fragment
    ):
        raise ValueError("Only the disposable stockpilot_load database is allowed")
    if (
        cache.scheme != "redis"
        or cache.hostname not in {"cache", "localhost", "127.0.0.1"}
        or cache.path != "/15"
        or cache.query
        or cache.fragment
    ):
        raise ValueError("Only isolated cache database 15 is allowed")
    if any(
        env.get(name)
        for name in (
            "KIS_APP_KEY",
            "KIS_APP_SECRET",
            "DART_API_KEY",
            "SEC_USER_AGENT",
            "GOOGLE_CLIENT_SECRET",
            "FIREBASE_SERVICE_ACCOUNT_B64",
            "TOSS_MTLS_KEY_B64",
            "TOSS_MTLS_CERT_B64",
            "TOSS_MTLS_KEY_PATH",
            "TOSS_MTLS_CERT_PATH",
        )
    ):
        raise ValueError(
            "Production/provider credentials must not enter the load fixture"
        )
    return database, env["REDIS_URL"]
