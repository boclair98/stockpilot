from contextlib import asynccontextmanager
from decimal import Decimal

import httpx
import pytest
from app.core.traffic import traffic_store
from app.services import market_browse as browse


@pytest.mark.asyncio
async def test_browsing_continues_beyond_600_with_shared_provider_prefixes(monkeypatch):
    await traffic_store.close()
    traffic_store._memory.clear()
    calls = []

    def respond(request):
        exchange = request.url.params["EXCD"]
        offset = int(request.url.params["KEYB"] or 0)
        calls.append((exchange, offset))
        if offset:
            assert request.headers["tr_cont"] == "N"
        count = min(100, max(0, 850 - offset))
        rows = []
        for i in range(offset, offset + count):
            price = (
                Decimal({"NAS": 1000, "NYS": 100, "AMS": 10}[exchange])
                - Decimal(i) / 1000
            )
            rows.append(
                {
                    "symb": f"{exchange}{i:06d}",
                    "excd": exchange,
                    "name": "fixture",
                    "last": str(price),
                    "shar": "1000000000",
                    "tomv": str(price * 1000000000),
                }
            )
        return httpx.Response(
            200,
            headers={"tr_cont": "F" if offset + count < 850 else "D"},
            json={"rt_cd": "0", "output1": {"curr": "USD"}, "output2": rows},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(respond))

    class Provider:
        configured = True
        rest_base = "https://provider.test"

        @asynccontextmanager
        async def _rest_slot(self):
            yield

        async def _rate_limit_rest(self):
            pass

        async def _token(self):
            return "mock"

        def _headers(self, token, tr):
            return {"tr_id": tr}

        def _client(self):
            return client

    monkeypatch.setattr(browse, "kis_market", Provider())
    epoch = None
    for end in range(100, 901, 100):
        result = await browse.browse_snapshot("US", "CAP", "ALL", end, epoch)
        epoch = result["asOf"]
        assert len(result["items"]) >= end
        assert not result["partial"]
    assert len(result["items"]) == 2550 and not result["providerHasMore"]
    assert all(r["exchange"] == "NAS" for r in result["items"][:850])
    assert len(calls) == 27
    before = len(calls)
    again = await browse.browse_snapshot("US", "CAP", "ALL", 700, epoch)
    assert len(calls) == before and len(again["items"]) == 2550
    await client.aclose()


@pytest.mark.asyncio
async def test_unknown_snapshot_is_rejected_without_creating_provider_work():
    await traffic_store.close()
    traffic_store._memory.clear()
    with pytest.raises(browse.SnapshotExpired):
        await browse.browse_snapshot("US", "CAP", "ALL", 50, "unknown")
