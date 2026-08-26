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

