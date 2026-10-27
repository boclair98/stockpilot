import httpx
import pytest
from scripts.load_capacity import parse_args, percentile, run_stage, validate_target


@pytest.mark.parametrize(
    "url",
    [
        "https://stockpilot.coders.kr",
        "https://stockpilot.kr",
        "https://www.stockpilot.kr",
        "http://127.0.0.1/api",
        "http://user:secret@localhost",
        "ftp://localhost",
        "https://example.com",
        "http://example.com",
        "http://localhost?token=secret",
        "http://localhost:99999",
    ],
)
def test_unsafe_targets_are_rejected(url):
    with pytest.raises(ValueError):
        validate_target(url)


def test_external_staging_requires_exact_host_and_https():
    assert validate_target("https://isolated.example.com", "isolated.example.com")
    with pytest.raises(ValueError):
        validate_target("https://stockpilot.coders.kr", "stockpilot.coders.kr")
    with pytest.raises(ValueError):
        validate_target("http://isolated.example.com", "isolated.example.com")
    assert validate_target("http://127.0.0.1:8276")
    assert validate_target("http://[::1]:8276")


def test_percentiles_nearest_rank():
    assert percentile(list(range(1, 101)), 0.95) == 95
    assert percentile([], 0.95) == 0


@pytest.mark.parametrize(
    "extra",
    [
        ["--rates", "40000"],
        ["--seconds", "0"],
        ["--concurrency", "501"],
        ["--max-p95-ms", "nan"],
    ],
)
def test_bounds_cannot_be_silently_disabled(extra):
    with pytest.raises(SystemExit):
        parse_args(["--output", "unused.json", *extra])


async def test_stage_validates_payload_not_only_http_200():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"available": False})
        ),
        base_url="http://test",
    ) as client:
        result = await run_stage(client, 5, 1, 10, 1000)
    assert not result["passed"]
    assert result["errors"]["invalid_payload"] == 5


async def test_overload_has_no_unbounded_queue_or_retry():
    import asyncio

    calls = 0

    async def slow(request):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.15)
        return httpx.Response(503)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(slow), base_url="http://test"
    ) as client:
        result = await run_stage(client, 100, 1, 2, 1000)
    assert not result["passed"]
    assert result["peakInFlight"] <= 2
    assert result["droppedByGenerator"] > 0
    assert calls == result["launched"] == result["completed"]
