import pytest
from app.services.instrument_catalog import Instrument, InstrumentCatalog


@pytest.mark.asyncio
async def test_exact_lookup_normalizes_market_and_exchange_without_scan() -> None:
    catalog = InstrumentCatalog()
    catalog._loaded = True
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
    curated = catalog.get_cached("005930", market="KR", exchange="KRX")
    assert curated is not None

    catalog._add(
        Instrument("005930", "다른 이름", "KR", "KRW", "KRX", "005930")
    )

    assert catalog.get_cached("005930", market="KR", exchange="KRX") is curated

