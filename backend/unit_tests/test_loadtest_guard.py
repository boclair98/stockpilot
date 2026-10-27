import pytest
from scripts.loadtest_guard import validate_environment


def environment():
    return {
        "STOCKPILOT_CAPACITY_FIXTURE": "1",
        "DATABASE_URL": "postgresql+asyncpg://load:load-only@db:5432/stockpilot_load",
        "REDIS_URL": "redis://cache:6379/15",
    }


def test_accepts_only_disposable_database():
    assert validate_environment(environment())[0].endswith("/stockpilot_load")


@pytest.mark.parametrize(
    "key,value",
    [
        ("STOCKPILOT_CAPACITY_FIXTURE", "0"),
        ("DATABASE_URL", "postgresql+asyncpg://load:x@db:5432/app"),
        (
            "DATABASE_URL",
            "postgresql+asyncpg://load:x@production.example/stockpilot_load",
        ),
        (
            "DATABASE_URL",
            "postgresql+asyncpg://load:x@db/stockpilot_load?host=production",
        ),
        ("REDIS_URL", "redis://cache:6379/0"),
        ("REDIS_URL", "redis://production.example/15"),
        ("KIS_APP_KEY", "must-not-be-real"),
        ("TOSS_MTLS_KEY_B64", "must-not-enter-fixture"),
    ],
)
def test_production_settings_fail_closed(key, value):
    env = environment()
    env[key] = value
    with pytest.raises(ValueError):
        validate_environment(env)
