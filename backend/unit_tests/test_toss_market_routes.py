import httpx
import pytest
from app.routes import toss_market
from app.services.instrument_catalog import Instrument, InstrumentCatalog
from fastapi import FastAPI


@pytest.mark.asyncio
async def test_page_can_browse_all_catalog_and_filter_listing_market():
    catalog = InstrumentCatalog()
    catalog._loaded = True
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
