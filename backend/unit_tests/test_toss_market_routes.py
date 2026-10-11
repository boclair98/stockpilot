import httpx
import pytest
from app.routes import toss_market
from app.services.instrument_catalog import Instrument, InstrumentCatalog
from fastapi import FastAPI


@pytest.mark.asyncio
async def test_page_can_browse_all_catalog_and_filter_listing_market():
    catalog = InstrumentCatalog()
    catalog._loaded = True
    catalog._loaded_exchanges = {"KOSPI", "KOSDAQ", "NAS", "NYS", "AMS"}
    for i in range(60):
        catalog._add(
            Instrument(
                f"{900000 + i}",
                "검증 종목",
                "KR",
                "KRW",
                "KRX",
                str(i),
                listing_market="KOSDAQ" if i % 2 else "KOSPI",
            )
        )
    first = await catalog.page("KR", "ALL", 0, 20)
    second = await catalog.page("KR", "ALL", 20, 20)
    assert first["total"] > 60 and len(first["items"]) == len(second["items"]) == 20
    assert not {r["symbol"] for r in first["items"]} & {
        r["symbol"] for r in second["items"]
    }
    assert (await catalog.page("KR", "KOSDAQ", 0, 100))["total"] == 30


@pytest.mark.asyncio
async def test_partial_catalog_never_claims_to_be_complete_or_paginated(monkeypatch):
    catalog = InstrumentCatalog()
    catalog._loaded_exchanges = {"KOSPI"}
    async def no_network_load():
        return None

    monkeypatch.setattr(catalog, "ensure_loaded", no_network_load)
    for i in range(25):
        catalog._add(
            Instrument(
                f"{910000 + i}", "종목", "KR", "KRW", "KRX", str(i),
                listing_market="KOSPI",
            )
        )

    partial = await catalog.page("KR", "ALL", 0, 20)
    assert partial["partial"] is True
    assert partial["hasMore"] is False and partial["nextOffset"] is None

    catalog._loaded_exchanges.add("KOSDAQ")
    complete = await catalog.page("KR", "ALL", 0, 20)
    assert complete["partial"] is False and complete["hasMore"] is True
    assert complete["nextOffset"] == 20


@pytest.mark.asyncio
async def test_ranking_http_pagination_and_snapshot_change(monkeypatch):
    async def snapshot(*args):
        return {
            "items": [{"symbol": f"{i:06d}"} for i in range(60)],
            "partial": False,
            "asOf": "2026-10-05T00:00:00Z",
        }

    monkeypatch.setattr(toss_market, "ranking_snapshot", snapshot)
    app = FastAPI()
    app.include_router(toss_market.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get("/api/toss-market/rankings?offset=20&limit=20")
        assert (
            result.status_code == 200
            and result.json()["items"][0]["symbol"] == "000020"
        )
        assert result.json()["total"] == 60 and result.json()["hasMore"]
        assert (
            await client.get("/api/toss-market/rankings?market=US&exchange=KOSPI")
        ).status_code == 422
        assert (
            await client.get("/api/toss-market/rankings?limit=101")
        ).status_code == 422
        assert (
            await client.get("/api/toss-market/rankings?snapshot=old")
        ).status_code == 409


@pytest.mark.asyncio
async def test_browse_market_cap_pages_continue_after_first_30(monkeypatch):
    async def snapshot(market, metric, exchange, target, requested=None):
        assert (market, metric, exchange) == ("KR", "CAP", "ALL")
        assert target <= 60
        return {
            "items": [{"symbol": f"{i:06d}"} for i in range(60)],
            "providerHasMore": False,
            "partial": False,
            "asOf": "2026-10-11T00:00:00Z",
        }

    monkeypatch.setattr(toss_market, "browse_snapshot", snapshot)
    app = FastAPI()
    app.include_router(toss_market.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.get("/api/toss-market/browse-rankings?offset=0&limit=20")
        second = await client.get(
            "/api/toss-market/browse-rankings?offset=20&limit=20&snapshot=2026-10-11T00:00:00Z"
        )
        third = await client.get(
            "/api/toss-market/browse-rankings?offset=40&limit=20&snapshot=2026-10-11T00:00:00Z"
        )

    assert [first.status_code, second.status_code, third.status_code] == [200] * 3
    assert [len(r.json()["items"]) for r in (first, second, third)] == [20] * 3
    assert [r.json()["items"][0]["symbol"] for r in (first, second, third)] == [
        "000000",
        "000020",
        "000040",
    ]
    assert [r.json()["hasMore"] for r in (first, second, third)] == [True, True, False]
    assert third.json()["nextOffset"] is None


@pytest.mark.asyncio
async def test_provider_failure_is_503_not_a_fake_empty_market(monkeypatch):
    async def snapshot(*args):
        return {"items": [], "partial": True}

    monkeypatch.setattr(toss_market, "ranking_snapshot", snapshot)
    app = FastAPI()
    app.include_router(toss_market.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get("/api/toss-market/rankings")
        assert result.status_code == 503 and result.headers["retry-after"] == "120"


@pytest.mark.asyncio
async def test_instrument_endpoint_exposes_real_paginated_catalog(monkeypatch):
    async def page(market, exchange, offset, limit):
        assert (market, exchange, offset, limit) == ("US", "NYS", 20, 20)
        return {
            "items": [
                Instrument("ACME", "Acme Corp", "US", "USD", "NYS", "DACME").public()
            ],
            "total": 41,
            "partial": False,
            "hasMore": True,
            "nextOffset": 40,
        }

    monkeypatch.setattr(toss_market.instrument_catalog, "page", page)
    app = FastAPI()
    app.include_router(toss_market.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get(
            "/api/toss-market/instruments?market=US&exchange=NYS&offset=20&limit=20"
        )
    assert result.status_code == 200
    payload = result.json()
    assert payload["total"] == 41 and payload["hasMore"] is True
    assert payload["nextOffset"] == 40 and payload["items"][0]["exchange"] == "NYS"
