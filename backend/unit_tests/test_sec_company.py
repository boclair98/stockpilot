import asyncio
from collections import Counter
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import httpx
import pytest
from app.core.config import settings
from app.core.traffic import TrafficStore
from app.routes import company as routes
from app.services.sec_company import (
    CACHE_SIZE,
    SecAPIError,
    SecCompanyService,
    parse_recent_filings,
    parse_ticker_directory,
    retry_after_seconds,
)
from fastapi import FastAPI


def filing(cik="320193", document="aapl.htm", form="10-K"):
    return {
        "cik": cik,
        "name": "Fixture issuer",
        "filings": {
            "recent": {
                "form": [form],
                "accessionNumber": ["0000320193-26-000001"],
                "filingDate": ["2026-10-01"],
                "primaryDocument": [document],
                "primaryDocDescription": ["Annual report"],
            }
        },
    }


def test_retry_after_delta_and_http_date_are_honored():
    assert retry_after_seconds("3600") == 3600
    assert retry_after_seconds("invalid") == 60
    assert (
        retry_after_seconds(format_datetime(datetime.now(UTC) + timedelta(hours=1)))
        > 3590
    )


@pytest.fixture
def environment(monkeypatch):
    monkeypatch.setattr(settings, "redis_url", None)
    monkeypatch.setattr(
        settings, "sec_user_agent", "StockPilot-test contact@example.com"
    )


def test_directory_ignores_invalid_and_zero_ciks():
    assert parse_ticker_directory(
        {
            "0": {"ticker": "AAPL", "cik_str": 320193, "title": "Apple"},
            "1": {"ticker": "INVALID", "cik_str": 0},
            "2": {"ticker": "BAD/X", "cik_str": "1"},
            "3": {"ticker": "BAD", "cik_str": "12345678901"},
            "4": None,
        }
    ) == {"AAPL": {"cik": "0000320193", "title": "Apple"}}


def test_filings_include_amendments_and_encode_document():
    rows = parse_recent_filings(filing(document="report/a b.htm", form="10-K/A"))
    assert len(rows) == 1
    assert rows[0]["url"].endswith("/000032019326000001/report/a%20b.htm")
    assert rows[0]["date"] == "20261001"


@pytest.mark.parametrize(
    "document", ["../secret", "/evil", "https://evil", "a\\b", "a//b", "./x"]
)
def test_unsafe_document_paths_are_not_returned(document):
    assert parse_recent_filings(filing(document=document)) == []


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"cik": "0"},
        {"cik": "invalid"},
        {"cik": "320193", "filings": []},
        {"cik": "320193", "filings": {"recent": {"form": "10-K"}}},
    ],
)
def test_malformed_filings_do_not_crash(payload):
    assert parse_recent_filings(payload) == []


async def test_no_configuration_never_calls_network(environment, monkeypatch):
    monkeypatch.setattr(settings, "sec_user_agent", "  ")

    def forbidden(request):
        pytest.fail("Unconfigured SEC must never call upstream")

    result = await SecCompanyService(transport=httpx.MockTransport(forbidden)).company(
        "AAPL"
    )
    assert result == {"configured": False, "available": False, "symbol": "AAPL"}


async def test_cold_burst_coalesces_and_class_alias_keeps_identity(environment):
    counts = Counter()

    async def upstream(request):
        counts[request.url.path] += 1
        assert request.headers["user-agent"] == settings.sec_user_agent
        await asyncio.sleep(0.005)
        if request.url.path.endswith("company_tickers.json"):
            return httpx.Response(
                200,
                json={
                    "0": {"ticker": "BRK-B", "cik_str": 1067983, "title": "Berkshire"}
                },
            )
        return httpx.Response(200, json=filing(cik="1067983"))

    service = SecCompanyService(
        store=TrafficStore(), transport=httpx.MockTransport(upstream)
    )
    results = await asyncio.gather(*(service.company("BRK/B") for _ in range(200)))
    other = await service.company("BRK.B")
    assert all(row["available"] and row["symbol"] == "BRK/B" for row in results)
    assert other["symbol"] == "BRK.B"
    assert results[0]["asOf"] == other["asOf"]
    assert sum(counts.values()) == 2  # one directory + one issuer, not 201 reads
    assert len(service._locks) == 0


async def test_unknown_symbols_do_not_grow_lock_or_cache_maps(environment):
    service = SecCompanyService(store=TrafficStore())
    service._remember(
        "sec:v2:tickers", {"AAPL": {"cik": "0000320193", "title": "Apple"}}, 100
    )
    results = await asyncio.gather(*(service.company(f"X{i}") for i in range(2000)))
    assert not any(row["available"] for row in results)
    assert len(service._locks) == 0 and len(service._cache) == 1
    for i in range(2000):
        service._remember(str(i), {"i": i}, 100)
    assert len(service._cache) == CACHE_SIZE


async def test_mismatched_issuer_never_enters_cache(environment):
    service = SecCompanyService(
        store=TrafficStore(),
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=filing(cik="1"))
        ),
    )
    service._remember(
        "sec:v2:tickers", {"AAPL": {"cik": "0000320193", "title": "Apple"}}, 100
    )
    with pytest.raises(SecAPIError, match="일치"):
        await service.company("AAPL")
    assert "sec:v2:company:0000320193" not in service._cache


async def test_upstream_429_stops_next_call_without_retry(environment):
    store = TrafficStore()
    count = 0

    def upstream(request):
        nonlocal count
        count += 1
        return httpx.Response(429, headers={"Retry-After": "120"})

    service = SecCompanyService(store=store, transport=httpx.MockTransport(upstream))
    with pytest.raises(SecAPIError):
        await service.company("AAPL")
    with pytest.raises(SecAPIError):
        await service.company("MSFT")
    assert count == 1
    assert await store.outbound_delay("sec-edgar", 500) > 119


async def test_configured_redis_outage_fails_closed(environment, monkeypatch):
    monkeypatch.setattr(settings, "redis_url", "redis://unused-test-host")
    store = TrafficStore()
    assert await store.outbound_delay("sec-edgar", 500) is None
    service = SecCompanyService(
        store=store,
        transport=httpx.MockTransport(
            lambda request: pytest.fail("No per-replica upstream fallback")
        ),
    )
    with pytest.raises(SecAPIError, match="제한기"):
        await service._get_json("https://data.sec.gov/submissions/CIK0000320193.json")
    with pytest.raises(SecAPIError, match="공유 공시 캐시"):
        async with asyncio.timeout(0.5):
            await service.company("AAPL")


async def test_provider_gate_serializes_and_does_not_shorten_cooldown(environment):
    store = TrafficStore()
    slots = await asyncio.gather(
        *(store.outbound_delay("sec-edgar", 500) for _ in range(100))
    )
    assert slots.count(0) == 1
    assert all(slot is not None and slot > 0.4 for slot in slots if slot)
    await store.defer_outbound("sec-edgar", 120)
    await store.defer_outbound("sec-edgar", 60)
    assert await store.outbound_delay("sec-edgar", 500) > 119


async def test_shared_cache_across_services_coalesces_by_cik(environment, monkeypatch):
    # In-memory coordinator double: checks the shared path; not Redis capacity proof.
    store = TrafficStore()
    monkeypatch.setattr(settings, "redis_url", "redis://test-double")
    store.available = True
    leases = set()

    async def acquire(key, ttl_seconds=30):
        if key in leases:
            return None
        leases.add(key)
        return "test-lease"

    async def release(key, token):
        leases.discard(key)

    async def paced(scope, interval):
        return 0

    monkeypatch.setattr(store, "acquire_lock", acquire)
    monkeypatch.setattr(store, "release_lock", release)
    monkeypatch.setattr(store, "outbound_delay", paced)
    counts = Counter()

    async def upstream(request):
        counts[request.url.path] += 1
        await asyncio.sleep(0.03)
        body = (
            {"0": {"ticker": "AAPL", "cik_str": 320193, "title": "Apple"}}
            if request.url.path.endswith("company_tickers.json")
            else filing()
        )
        return httpx.Response(200, json=body)

    services = [
        SecCompanyService(store=store, transport=httpx.MockTransport(upstream))
        for _ in range(4)
    ]
    rows = await asyncio.gather(*(services[i % 4].company("AAPL") for i in range(100)))
    assert all(row["available"] for row in rows)
    assert sum(counts.values()) == 2


async def test_unconfigured_and_errors_are_not_publicly_cached(
    environment, monkeypatch
):
    app = FastAPI()
    app.include_router(routes.router)
    monkeypatch.setattr(settings, "sec_user_agent", None)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        result = await client.get("/api/company/us/AAPL")
        assert result.headers["cache-control"] == "no-store"

        async def failure(symbol):
            raise SecAPIError("test")

        monkeypatch.setattr(routes.sec_company, "company", failure)
        result = await client.get("/api/company/us/AAPL")
        assert result.status_code == 502
        assert result.headers["cache-control"] == "no-store"
        assert result.headers["retry-after"] == "60"
