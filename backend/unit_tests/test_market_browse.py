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
async def test_domestic_market_cap_can_continue_past_first_30_rows(monkeypatch):
    await traffic_store.close()
    traffic_store._memory.clear()
    calls = []
    leases = set()

    async def acquire_lock(key, ttl_seconds=60):
        if key in leases:
            return None
        leases.add(key)
        return key

    async def release_lock(key, token):
        leases.discard(key)
        return True

    monkeypatch.setattr(traffic_store, "acquire_lock", acquire_lock)
    monkeypatch.setattr(traffic_store, "release_lock", release_lock)

    def respond(request):
        page = len(calls)
        calls.append(request)
        start = page * 10
        rows = [
            {
                "mksc_shrn_iscd": f"{i:06d}",
                "hts_kor_isnm": f"국내 종목 {i}",
                "stck_prpr": "100000",
                "lstn_stcn": "1000000000",
                "stck_avls": "1000000",
                "prdy_ctrt": "1.2",
                "acml_vol": "10000",
            }
            for i in range(start, start + 10)
        ]
        return httpx.Response(
            200,
            headers={"tr_cont": "M" if start + 10 < 60 else "D"},
            json={"rt_cd": "0", "output": rows},
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
    first = await browse.browse_snapshot("KR", "CAP", "KOSPI", 20)
    epoch = first["asOf"]
    second = await browse.browse_snapshot("KR", "CAP", "KOSPI", 40, epoch)
    third = await browse.browse_snapshot("KR", "CAP", "KOSPI", 70, epoch)
    await client.aclose()

    assert len(first["items"]) >= 20
    assert len(second["items"]) >= 40
    assert len(third["items"]) == 60
    assert len({row["symbol"] for row in third["items"]}) == 60
    assert third["providerHasMore"] is False
    assert len(calls) == 6
    assert calls[0].headers.get("tr_cont") is None
    assert all(call.headers["tr_cont"] == "N" for call in calls[1:])


@pytest.mark.asyncio
async def test_all_korean_rankings_merge_kospi_and_kosdaq_top_rows(monkeypatch):
    await traffic_store.close()
    traffic_store._memory.clear()
    calls = []

    def respond(request):
        calls.append(request)
        market_code = request.url.params["FID_INPUT_ISCD"]
        start = 1 if market_code == "0001" else 101
        rows = [
            {
                "mksc_shrn_iscd": f"{i:06d}",
                "hts_kor_isnm": f"국내 종목 {i}",
                "stck_prpr": "100000",
                "lstn_stcn": "1000000000",
                "stck_avls": "1000000",
                "prdy_ctrt": "1.2",
                "acml_vol": "10000",
            }
            for i in range(start, start + 30)
        ]
        return httpx.Response(
            200,
            headers={"tr_cont": "D"},
            json={"rt_cd": "0", "output": rows},
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
    first = await browse.browse_snapshot("KR", "CAP", "ALL", 20)
    epoch = first["asOf"]
    second = await browse.browse_snapshot("KR", "CAP", "ALL", 40, epoch)
    third = await browse.browse_snapshot("KR", "CAP", "ALL", 60, epoch)
    await client.aclose()

    # browse_snapshot keeps a shared, cached prefix; the HTTP route slices it
    # to the requested page. Assert prefix growth here, not page-sized output.
    assert len(first["items"]) >= 20
    assert len(second["items"]) >= 40
    assert len(third["items"]) == 60
    assert len({row["symbol"] for row in third["items"]}) == 60
    assert third["providerHasMore"] is False
    assert {call.url.params["FID_INPUT_ISCD"] for call in calls} == {"0001", "1001"}
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_unknown_snapshot_is_rejected_without_creating_provider_work():
    await traffic_store.close()
    traffic_store._memory.clear()
    with pytest.raises(browse.SnapshotExpired):
        await browse.browse_snapshot("US", "CAP", "ALL", 50, "unknown")
