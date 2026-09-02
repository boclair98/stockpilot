import asyncio

from app.core.traffic import RequestMetrics, TrafficStore


async def test_local_cache_single_flight_calls_factory_once():
    store = TrafficStore()
    calls = 0

    async def factory() -> dict:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return {"value": 42}

    results = await asyncio.gather(
        *(store.get_or_set("same-key", 10, factory) for _ in range(12))
    )

    assert results == [{"value": 42}] * 12
    assert calls == 1


async def test_local_rate_limit_stops_after_limit():
    store = TrafficStore()

    assert await store.allow("user:write", 2)
    assert await store.allow("user:write", 2)
    assert not await store.allow("user:write", 2)


async def test_local_connection_slots_are_bounded_and_released():
    store = TrafficStore()

    first = await store.acquire_connection_slot("ip:127.0.0.1", limit=1)
    assert first
    assert await store.acquire_connection_slot("ip:127.0.0.1", limit=1) is None

    assert await store.release_connection_slot("ip:127.0.0.1", first)
    second = await store.acquire_connection_slot("ip:127.0.0.1", limit=1)
    assert second


async def test_local_connection_slot_renew_requires_owner():
    store = TrafficStore()

    token = await store.acquire_connection_slot("user:demo", limit=1)
    assert token
    assert await store.renew_connection_slot("user:other", token) is False
    assert await store.renew_connection_slot("user:demo", token)


async def test_request_metrics_are_aggregated_without_user_data():
    metrics = RequestMetrics()
    await metrics.begin()
    await metrics.finish(503, 25.5)

    snapshot = await metrics.snapshot()

    assert snapshot["requests"] == 1
    assert snapshot["serverErrors"] == 1
    assert snapshot["inFlight"] == 0
    assert snapshot["statuses"] == {"5xx": 1}
