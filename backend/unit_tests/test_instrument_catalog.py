import asyncio
import zipfile
from collections import Counter
from io import BytesIO

import httpx
import pytest
from app.services import instrument_catalog as catalog_service
from app.services.instrument_catalog import MASTER_URLS, Instrument, InstrumentCatalog


@pytest.mark.asyncio
async def test_exact_lookup_normalizes_market_and_exchange_without_scan() -> None:
    catalog = InstrumentCatalog()
    catalog._loaded = True
    catalog._loaded_exchanges = set(MASTER_URLS)
    item = Instrument(
        "AcMe",
        "Acme Corp",
        "US",
        "USD",
        "NAS",
        "DNASAcMe",
        "Acme Corp",
    )
    catalog._add(item)

    assert await catalog.get("acme", market="us", exchange="nas") is item
    assert catalog.get_cached("ACME", market="US", exchange="NAS") is item


@pytest.mark.asyncio
async def test_curated_top_instrument_is_not_replaced_by_master_duplicate() -> None:
    catalog = InstrumentCatalog()
    catalog._loaded = True
    catalog._loaded_exchanges = set(MASTER_URLS)
    curated = catalog.get_cached("005930", market="KR", exchange="KRX")
    assert curated is not None

    catalog._add(Instrument("005930", "다른 이름", "KR", "KRW", "KRX", "005930"))

    assert catalog.get_cached("005930", market="KR", exchange="KRX") is curated


@pytest.mark.asyncio
async def test_search_uses_normalized_index_and_keeps_exact_match_first() -> None:
    catalog = InstrumentCatalog()
    catalog._loaded = True
    catalog._loaded_exchanges = set(MASTER_URLS)
    exact = Instrument("ACME", "에이씨미", "US", "USD", "NAS", "DNASACME")
    prefix = Instrument("ACME2", "Acme Holdings", "US", "USD", "NAS", "DNASACME2")
    catalog._add(prefix)
    catalog._add(exact)

    results = await catalog.search("acme", market="US", limit=2)

    assert [item["symbol"] for item in results] == ["ACME", "ACME2"]


def _archive(raw: bytes) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("fixture.mst", raw)
    return buf.getvalue()


def _valid_master(exchange: str) -> bytes:
    if exchange in {"KOSPI", "KOSDAQ"}:
        code, width = ("111111", 227) if exchange == "KOSPI" else ("111112", 221)
        return _archive(
            (f"{code:<9}KR7000000000검증 종목" + "0" * width + "\n").encode("cp949")
        )
    return _archive(
        f"0\t0\t0\t0\tFIX{exchange}\t{exchange}FIX\t테스트\tFixture\t2\t0\n".encode(
            "cp949"
        )
    )


def _mock_network(monkeypatch, handler) -> None:
    async_client = httpx.AsyncClient

    def client(**kwargs):
        return async_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(catalog_service.httpx, "AsyncClient", client)


URL_TO_EXCHANGE = {url: exchange for exchange, url in MASTER_URLS.items()}


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["http-error", "bad-zip", "empty-master"])
async def test_one_bad_exchange_preserves_other_markets_and_retries_only_it(
    monkeypatch, failure
) -> None:
    provider_clock = [100.0]
    monkeypatch.setattr(catalog_service, "monotonic", lambda: provider_clock[0])
    counts: Counter[str] = Counter()

    def handler(request: httpx.Request) -> httpx.Response:
        exchange = URL_TO_EXCHANGE[str(request.url)]
        counts[exchange] += 1
        if exchange == "KOSPI" and counts[exchange] == 1:
            if failure == "http-error":
                return httpx.Response(503)
            failed_data = b"not a zip" if failure == "bad-zip" else _archive(b"")
            return httpx.Response(200, content=failed_data)
        return httpx.Response(200, content=_valid_master(exchange))

    _mock_network(monkeypatch, handler)
    catalog = InstrumentCatalog()
    # Curated/pre-existing data remains useful even if the official source
    # cannot currently verify full coverage for its market.
    seed = catalog.get_cached("005930", market="KR", exchange="KRX")

    domestic = await catalog.directory("KR", "ALL", "", 0, 20)
    coverage = {row["exchange"]: row for row in domestic["coverage"]}
    assert domestic["partial"] is True
    assert coverage["KOSPI"]["available"] is False
    assert coverage["KOSPI"]["loadedAt"] is None
    assert coverage["KOSDAQ"]["available"] is True
    assert coverage["KOSDAQ"]["loadedAt"] is not None
    assert catalog.get_cached("005930", market="KR", exchange="KRX") is seed
    assert (await catalog.directory("US", "ALL", "", 0, 20))["partial"] is False
    assert counts == dict.fromkeys(MASTER_URLS, 1)

    provider_clock[0] += catalog_service.MASTER_RETRY_SECONDS
    recovered = await catalog.directory("KR", "ALL", "111111", 0, 20)
    assert recovered["partial"] is False
    assert [item["symbol"] for item in recovered["items"]] == ["111111"]
    assert counts == {**dict.fromkeys(MASTER_URLS, 1), "KOSPI": 2}
    assert catalog.last_error is None


@pytest.mark.asyncio
async def test_slow_exchange_is_cancelled_without_losing_other_results(
    monkeypatch,
) -> None:
    slow_cancelled = asyncio.Event()
    monkeypatch.setattr(catalog_service, "MASTER_DOWNLOAD_SECONDS", 0.05)

    async def handler(request: httpx.Request) -> httpx.Response:
        exchange = URL_TO_EXCHANGE[str(request.url)]
        if exchange == "KOSPI":
            try:
                await asyncio.Event().wait()
            finally:
                slow_cancelled.set()
        return httpx.Response(200, content=_valid_master(exchange))

    _mock_network(monkeypatch, handler)
    catalog = InstrumentCatalog()

    result = await asyncio.wait_for(catalog.directory("KR", "ALL", "", 0, 20), 2)
    assert slow_cancelled.is_set()
    assert result["partial"] is True
    assert not catalog._lock.locked()
    assert catalog._loaded_exchanges == set(MASTER_URLS) - {"KOSPI"}


@pytest.mark.asyncio
async def test_cancelled_catalog_call_leaves_no_failed_retry_deadline(
    monkeypatch,
) -> None:
    slow_started = asyncio.Event()
    slow_cancelled = asyncio.Event()
    should_wait = True

    async def handler(request: httpx.Request) -> httpx.Response:
        exchange = URL_TO_EXCHANGE[str(request.url)]
        if should_wait and exchange == "KOSPI":
            slow_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                slow_cancelled.set()
        return httpx.Response(200, content=_valid_master(exchange))

    _mock_network(monkeypatch, handler)
    catalog = InstrumentCatalog()
    first = asyncio.create_task(catalog.ensure_loaded())
    await asyncio.wait_for(slow_started.wait(), 2)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert slow_cancelled.is_set()
    assert not catalog._lock.locked()
    assert not catalog._master_retry_after

    should_wait = False
    await catalog.ensure_loaded()
    assert catalog._loaded_exchanges == set(MASTER_URLS)
