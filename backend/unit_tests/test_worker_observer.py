import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from app.core.config import settings
from app.core.identity import SESSION_COOKIE, encode_session
from app.core.traffic import TrafficStore
from app.routes.operations import router
from app.services.worker_observer import JOBS, WorkerObserver, age_seconds
from fastapi import FastAPI


@pytest.fixture
def observer(monkeypatch):
    monkeypatch.setattr(settings, "redis_url", None)
    return WorkerObserver(TrafficStore())


async def test_unseen_worker_is_not_healthy(observer):
    status = await observer.status()
    assert status["status"] == "unknown"
    assert all(row["state"] == "unknown" for row in status["jobs"])


async def test_success_is_sweep_not_order_count(observer):
    async def work():
        return 0

    await observer.beat({name: True for name in JOBS})
    for name in JOBS:
        assert await observer.run(name, work) == 0
    status = await observer.status()
    assert status["status"] == "healthy"
    assert all(row["lastSuccessAt"] for row in status["jobs"])
    assert "account" not in str(status).lower()


async def test_failure_preserves_last_success_and_never_stores_exception_text(observer):
    async def ok():
        return 1

    async def bad():
        raise ValueError("private-user-credentials-must-not-appear")

    await observer.beat({name: True for name in JOBS})
    await observer.run("alerts", ok)
    before = (await observer.status())["jobs"][0]["lastSuccessAt"]
    with pytest.raises(ValueError):
        await observer.run("alerts", bad)
    result = await observer.status()
    assert result["status"] == "degraded"
    assert result["jobs"][0]["state"] == "failed"
    assert result["jobs"][0]["lastSuccessAt"] == before
    assert result["jobs"][0]["errorType"] == "ValueError"
    assert "private-user" not in str(result)


async def test_cancelled_sweep_not_success(observer):
    started = asyncio.Event()

    async def work():
        started.set()
        await asyncio.Event().wait()

    task = asyncio.create_task(observer.run("alerts", work))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    row = await observer.store.get_json("worker:job:alerts")
    assert row["state"] == "interrupted" and row["lastSuccessAt"] is None


async def test_stale_and_missing_heartbeat_do_not_look_healthy(observer):
    now = datetime.now(UTC)

    async def ok():
        pass

    await observer.beat({name: True for name in JOBS})
    for name in JOBS:
        await observer.run(name, ok)
    await observer.store.set_json(
        "worker:job:alerts",
        {
            "state": "ok",
            "startedAt": (now - timedelta(minutes=4)).isoformat(),
            "lastSuccessAt": (now - timedelta(minutes=4)).isoformat(),
        },
        600,
    )
    assert (await observer.status())["jobs"][0]["state"] == "stale"
    await observer.store.set_json(
        "worker:heartbeat", {"at": (now - timedelta(minutes=2)).isoformat()}, 600
    )
    assert (await observer.status())["status"] == "unknown"


async def test_observation_failure_does_not_block_business_action(
    observer, monkeypatch
):
    async def broken(*args, **kwargs):
        raise OSError("redis unavailable")

    async def action():
        return 42

    monkeypatch.setattr(observer.store, "get_json", broken)
    monkeypatch.setattr(observer.store, "set_json", broken)
    assert await observer.run("alerts", action) == 42
    assert (await observer.status())["status"] == "unknown"


def test_invalid_or_future_timestamps_are_unknown():
    now = datetime.now(UTC)
    assert age_seconds(None, now) is None
    assert age_seconds("broken", now) is None
    assert age_seconds("2026-10-28T00:00:00", now) is None
    assert age_seconds((now + timedelta(minutes=5)).isoformat(), now) is None


async def test_worker_status_requires_operator():
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        response = await client.get("/api/operations/workers")
    assert response.status_code == 401


async def test_worker_status_allowlist_and_private_cache_headers(observer, monkeypatch):
    import app.routes.operations as operations

    monkeypatch.setattr(settings, "operator_emails", "operator@example.test")
    monkeypatch.setattr(settings, "auth_session_secret", "isolated-worker-authorization-test")
    monkeypatch.setattr(operations, "worker_observer", observer)
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        for email, expected in [
            ("other@example.test", 403),
            ("operator@example.test", 200),
        ]:
            client.cookies.set(
                SESSION_COOKIE,
                encode_session(
                    {
                        "id": "00000000-0000-0000-0000-000000000123",
                        "email": email,
                    }
                ),
            )
            response = await client.get("/api/operations/workers")
            assert response.status_code == expected
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["vary"] == "Cookie"
        assert "@example.test" not in response.text


async def test_timeout_is_failure_and_propagates(observer, monkeypatch):
    import app.services.worker_observer as module

    monkeypatch.setattr(module, "JOB_TIMEOUT_SECONDS", 0.01)

    async def stalled():
        await asyncio.Event().wait()

    with pytest.raises(TimeoutError):
        await observer.run("protections", stalled)
    row = await observer.store.get_json("worker:job:protections")
    assert row["state"] == "failed"
    assert row["errorType"] == "TimeoutError"
    assert row["lastSuccessAt"] is None


async def test_dead_task_and_corrupt_values_do_not_look_healthy(observer):
    async def ok():
        pass

    for name in JOBS:
        await observer.run(name, ok)
    await observer.beat({"alerts": True})
    assert (await observer.status())["status"] == "degraded"
    await observer.store.set_json(
        "worker:job:alerts",
        {
            "state": "ok",
            "startedAt": "not-a-date",
            "lastSuccessAt": "not-a-date",
            "durationMs": True,
        },
        600,
    )
    row = (await observer.status())["jobs"][0]
    assert row["state"] == "unknown"
    assert row["startedAt"] is None and row["lastSuccessAt"] is None
    assert row["durationMs"] is None


async def test_root_probe_is_lightweight_without_starting_workers():
    from app.worker import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        response = await client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "worker"}
