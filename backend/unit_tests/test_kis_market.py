import asyncio

import pytest
from app.core.config import settings
from app.core.traffic import traffic_store
from app.services.kis_market import TOP_INSTRUMENTS, KISMarket


@pytest.mark.asyncio
async def test_quote_fetch_fails_fast_when_shared_market_request_stalls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    market = KISMarket()
    monkeypatch.setattr(settings, "market_data_request_timeout_seconds", 0.02)

    async def stalled(*args, **kwargs):
        await asyncio.sleep(0.2)

    monkeypatch.setattr(traffic_store, "get_or_set", stalled)

    assert await market.fetch_quote(TOP_INSTRUMENTS[0]) is None


@pytest.mark.asyncio
async def test_featured_snapshot_uses_local_quote_when_shared_cache_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    market = KISMarket()
    instrument = TOP_INSTRUMENTS[0]
    market._store(instrument, "80000", "1000", "1.25", "REST", volume="12345", market_cap_eok="450000")

    async def missing_cache(key: str):
        return None

    scheduled = []
    monkeypatch.setattr(traffic_store, "get_json", missing_cache)
    monkeypatch.setattr(market, "schedule_featured_refresh", lambda: scheduled.append(True))

    rows = await market.shared_snapshot(top_only=True)
    assert len(rows) == 1
    assert rows[0]["volume"] == 12345
    assert rows[0]["marketCapEok"] == 450000
    assert scheduled == [True]


def test_stream_tick_keeps_last_rest_volume_and_market_cap() -> None:
    market = KISMarket()
    instrument = TOP_INSTRUMENTS[0]
    market._store(instrument, "80000", "1000", "1.25", "REST", volume="12345", market_cap_eok="450000")
    market._store(instrument, "80100", "1100", "1.39", "WebSocket")
    quote = market.quote(instrument.symbol, instrument.market, instrument.exchange)
    assert quote is not None
    assert quote["volume"] == 12345
    assert quote["marketCapEok"] == 450000

