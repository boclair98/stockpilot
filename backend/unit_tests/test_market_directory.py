"""Directory tests use isolated catalog data, never production accounts."""

import io
import zipfile

import httpx
import pytest
from app.routes import company, market_directory
from app.services.dart_company import parse_corp_codes
from app.services.instrument_catalog import MASTER_URLS, Instrument, InstrumentCatalog
from app.services.market_rankings import normalize_row
from fastapi import FastAPI


def catalog_fixture():
    catalog = InstrumentCatalog()
    catalog._loaded_exchanges = set(MASTER_URLS)
    catalog._loaded = True
    for i in range(147):
        catalog._add(
            Instrument(
                f"{800000 + i}",
                f"검증 기업 {i}",
                "KR",
                "KRW",
                "KRX",
                str(i),
                listing_market="KOSDAQ",
            )
        )
    for i in range(121):
        catalog._add(
            Instrument(
                f"ACME{i:03}",
                f"에이씨미 {i}",
                "US",
                "USD",
                "NYS",
                str(i),
                f"Acme Holdings {i}",
            )
        )
    return catalog


@pytest.mark.parametrize("exchange,width", [("KOSPI", 227), ("KOSDAQ", 221)])
@pytest.mark.parametrize("ending", ["\n", "\r\n", ""])
def test_domestic_parser_preserves_full_names_codes_and_excludes_fund_alias(
    exchange, width, ending
):
    def row(code, name):
        return (f"{code:<9}KR7000000000{name}" + "0" * width + ending).encode("cp949")

    raw = (
        row("005930", "삼성전자")
        + (b"\n" if not ending else b"")
        + row("0001A0", "덕양에너젠")
        + (b"\n" if not ending else b"")
        + row("F70100034", "펀드 식별자")
    )
    items = InstrumentCatalog._parse_domestic(raw, exchange)
    assert [(item.symbol, item.name) for item in items] == [
        ("005930", "삼성전자"),
        ("0001A0", "덕양에너젠"),
    ]
    assert all(item.listing_market == exchange for item in items)


def test_dart_corporation_mapping_accepts_six_character_letter_code():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(
            "CORPCODE.xml",
            "<result><list><stock_code>0001A0</stock_code><corp_code>12345678</corp_code></list></result>",
        )
    assert parse_corp_codes(stream.getvalue()) == {"0001A0": "12345678"}


def test_rankings_keep_letter_codes_and_slash_share_class_identity():
    kr = normalize_row(
        {"mksc_shrn_iscd": "0001A0", "stck_prpr": "10000"},
        "KR",
        "ALL",
        "2026-10-27T00:00:00Z",
    )
    us = normalize_row(
        {"symb": "BRK/B", "last": "500", "excd": "NYS"},
        "US",
        "NYS",
        "2026-10-27T00:00:00Z",
    )
    assert kr["symbol"] == "0001A0" and us["symbol"] == "BRK/B"


@pytest.mark.asyncio
async def test_us_company_query_preserves_slash_without_path_ambiguity(monkeypatch):
    async def lookup(symbol):
        assert symbol == "BRK/B"
        return {"symbol": symbol, "configured": False, "available": False}

    monkeypatch.setattr(company.sec_company, "company", lookup)
    app = FastAPI()
    app.include_router(company.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get("/api/company/us-lookup", params={"symbol": "BRK/B"})
        assert result.status_code == 200 and result.json()["symbol"] == "BRK/B"
        assert (
            await client.get("/api/company/us-lookup", params={"symbol": "BRK<script>"})
        ).status_code == 422


@pytest.mark.asyncio
async def test_all_pages_search_last_page_and_exchange_scope_without_quote_calls():
    catalog = catalog_fixture()
    seen = []
    offset = 0
    first = await catalog.directory("US", "NYS", "", offset, 20)
    while True:
        page = await catalog.directory("US", "NYS", "", offset, 20)
        assert page["snapshot"] == first["snapshot"]
        seen.extend(item["id"] for item in page["items"])
        if not page["hasMore"]:
            break
        offset += 20
    assert len(seen) == len(set(seen)) == 121
    assert len(page["items"]) == 1 and page["total"] == 121
    result = await catalog.directory("US", "NYS", "holdings", 100, 20)
    assert len(result["items"]) == 20 and result["total"] == 121
    exact = await catalog.directory("US", "NYS", "acme010", 0, 20)
    assert exact["items"][0]["symbol"] == "ACME010"
    kr = await catalog.directory("KR", "KOSDAQ", "검증", 0, 100)
    assert kr["total"] == 147 and kr["universeTotal"] == 147
    assert len(kr["items"]) == 100
    empty_page = await catalog.directory("KR", "KOSDAQ", "검증", 200, 100)
    assert empty_page["items"] == [] and empty_page["total"] == 147


@pytest.mark.asyncio
async def test_partial_does_not_claim_complete_or_invent_source_time():
    catalog = catalog_fixture()
    catalog._loaded_exchanges.remove("AMS")

    async def no_download():
        pass

    catalog.ensure_loaded = no_download
    page = await catalog.directory("US", "ALL", "", 0, 20)
    assert page["partial"]
    assert next(row for row in page["coverage"] if row["exchange"] == "AMS") == {
        "exchange": "AMS",
        "available": False,
        "loadedAt": None,
    }


@pytest.mark.asyncio
async def test_version_changes_on_new_instrument_not_query_or_time():
    catalog = catalog_fixture()
    a = await catalog.directory("KR", "ALL", "", 0, 20)
    b = await catalog.directory("KR", "ALL", "삼성", 0, 20)
    assert a["snapshot"] == b["snapshot"]
    catalog._add(
        Instrument(
            "0001A0",
            "덕양에너젠",
            "KR",
            "KRW",
            "KRX",
            "0001A0",
            listing_market="KOSDAQ",
        )
    )
    c = await catalog.directory("KR", "ALL", "", 0, 20)
    assert c["snapshot"] != a["snapshot"]


@pytest.mark.asyncio
async def test_route_validates_paging_identity_versions_and_cache_policy(monkeypatch):
    catalog = catalog_fixture()
    monkeypatch.setattr(market_directory, "instrument_catalog", catalog)
    app = FastAPI()
    app.include_router(market_directory.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/market/instruments?market=KR&exchange=KOSDAQ&limit=100"
        )
        assert response.status_code == 200 and len(response.json()["items"]) == 100
        assert "public" in response.headers["cache-control"]
        second = await client.get(
            "/api/market/instruments?market=KR&exchange=KOSDAQ&limit=100&offset=100&snapshot="
            + response.json()["snapshot"]
        )
        assert second.status_code == 200 and len(second.json()["items"]) == 47
        query = await client.get("/api/market/instruments?market=US&q=holdings")
        assert query.status_code == 200 and query.headers["cache-control"] == "no-store"
        for params in [
            "market=US&exchange=KOSPI",
            "limit=21",
            "limit=101",
            "offset=-1",
            "offset=50001",
            "q=" + "a" * 81,
        ]:
            assert (
                await client.get("/api/market/instruments?" + params)
            ).status_code == 422
        assert (
            await client.get("/api/market/instruments?snapshot=changed")
        ).status_code == 409


@pytest.mark.asyncio
async def test_timeout_is_recoverable_not_zero_stocks(monkeypatch):
    async def timeout(*args):
        raise TimeoutError()

    monkeypatch.setattr(market_directory.instrument_catalog, "directory", timeout)
    app = FastAPI()
    app.include_router(market_directory.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get("/api/market/instruments")
    assert result.status_code == 503 and result.headers["retry-after"] == "10"
