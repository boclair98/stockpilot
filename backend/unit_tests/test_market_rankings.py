from contextlib import asynccontextmanager

import httpx
import pytest
from app.core.traffic import traffic_store
from app.services import market_rankings as rankings

STAMP = "2026-10-05T00:00:00+00:00"


def domestic(**extra):
    return {
        "mksc_shrn_iscd": "005930",
        "hts_kor_isnm": "삼성전자",
        "stck_prpr": "100000",
        "lstn_stcn": "1000000000",
        "stck_avls": "1000000",
        "prdy_ctrt": "2",
        "acml_vol": "123456",
        **extra,
    }


def test_domestic_cap_is_cross_checked_and_converted_to_eok():
    row = rankings.normalize_row(domestic(), "KR", "ALL", STAMP)
    assert row["marketCapEok"] == 1000000
    assert row["marketCapUsd"] is None
    assert (
        rankings.normalize_row(domestic(stck_avls="7"), "KR", "ALL", STAMP)[
            "marketCapEok"
        ]
        is None
    )


def test_us_cap_is_not_capital_stock_and_currency_is_isolated():
    raw = {
        "symb": "ABC",
        "excd": "NAS",
        "last": "200",
        "shar": "1000000000",
        "tomv": "200000",
        "mcap": "1",
        "rate": "2",
        "sign": "5",
        "tvol": "10000",
    }
    row = rankings.normalize_row(raw, "US", "NAS", STAMP)
    assert row["marketCapUsd"] == 200000000000
    assert row["marketCapEok"] is None
    assert row["changePercent"] == -2
    assert rankings.normalize_row(raw, "US", "NYS", STAMP) is None


@pytest.mark.parametrize("value", [None, "", "NaN", "Infinity", "0", "-1", "1e999"])
def test_missing_prices_are_not_fabricated(value):
    assert rankings.normalize_row(domestic(stck_prpr=value), "KR", "ALL", STAMP) is None


def test_market_request_filters_and_real_daily_us_rank_endpoint():
    assert rankings.request_spec("US", "CAP", "NAS")[2]["CURR_GB"] == "0"
    assert rankings.request_spec("KR", "UP", "ALL")[2]["FID_INPUT_CNT_1"] == "0"
    assert rankings.request_spec("KR", "CAP", "KOSDAQ")[2]["FID_INPUT_ISCD"] == "1001"
    path, tr, params = rankings.request_spec("US", "DOWN", "NYS")
    assert path.endswith("updown-rate") and tr == "HHDFS76290000"
    assert params["NDAY"] == "0" and params["GUBN"] == "0"
    with pytest.raises(ValueError):
        rankings.request_spec("US", "CAP", "KOSPI")


def test_sort_and_dedup_can_contain_more_than_ten_companies():
    rows = [
        rankings.normalize_row(
            domestic(
                mksc_shrn_iscd=f"{i:06d}",
                stck_avls=str(1000000 + i),
                lstn_stcn=str((1000000 + i) * 1000),
            ),
            "KR",
            "ALL",
            STAMP,
        )
        for i in range(100)
    ]
    ordered = rankings.ordered_rows(rows + rows, "KR", "CAP")
    assert len(ordered) == 100
    assert ordered[0]["symbol"] == "000099"


@pytest.mark.asyncio
async def test_shared_cache_coalesces_users_and_reads_provider_pagination(monkeypatch):
    await traffic_store.close()
    await traffic_store.delete(
        "market:rankings:v2:KR:CAP:ALL", "market:rankings:v2:KR:CAP:ALL:last"
    )
    calls = []

    def respond(request):
        calls.append(request)
        page = len(calls)
        return httpx.Response(
            200,
            headers={"tr_cont": "M" if page == 1 else "D"},
            json={
                "rt_cd": "0",
                "output": [
                    domestic(mksc_shrn_iscd=f"{i:06d}")
                    for i in range((page - 1) * 30, page * 30)
                ],
            },
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

    monkeypatch.setattr(rankings, "kis_market", Provider())
    import asyncio

    results = await asyncio.gather(
        *(rankings.provider_exchange("KR", "CAP", "ALL") for _ in range(20))
    )
    assert len(calls) == 2 and calls[1].headers["tr_cont"] == "N"
    assert all(len(result["rows"]) == 60 for result in results)
    await client.aclose()


@pytest.mark.asyncio
async def test_provider_failure_is_cached_without_fake_rows(monkeypatch):
    await traffic_store.close()
    await traffic_store.delete(
        "market:rankings:v2:US:CAP:AMS", "market:rankings:v2:US:CAP:AMS:last"
    )

    class MissingProvider:
        configured = False

    monkeypatch.setattr(rankings, "kis_market", MissingProvider())
    result = await rankings.provider_exchange("US", "CAP", "AMS")
    assert result["failed"] and result["rows"] == [] and result["asOf"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("currency", ["USD", "EUR"])
async def test_us_currency_and_offset_continuation_are_verified(monkeypatch, currency):
    await traffic_store.close()
    await traffic_store.delete(
        "market:rankings:v2:US:CAP:NAS", "market:rankings:v2:US:CAP:NAS:last"
    )
    calls = []

    def respond(request):
        calls.append(request)
        offset = int(request.url.params.get("KEYB") or 0)
        assert request.url.params["CURR_GB"] == "0"
        if offset:
            assert request.headers["tr_cont"] == "N"
        return httpx.Response(
            200,
            headers={"tr_cont": "F"},
            json={
                "rt_cd": "0",
                "output1": {"curr": currency, "nrec": "100", "trec": "1000"},
                "output2": [
                    {
                        "symb": f"ABC{i}",
                        "name": "fixture",
                        "excd": "NAS",
                        "last": "200",
                        "shar": "1000000000",
                        "tomv": "200000000000",
                    }
                    for i in range(offset, offset + 100)
                ],
            },
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

    monkeypatch.setattr(rankings, "kis_market", Provider())
    result = await rankings.provider_exchange("US", "CAP", "NAS")
    if currency == "USD":
        assert (
            len(result["rows"]) == 300
            and result["providerHasMore"]
            and not result["failed"]
        )
        assert [r.url.params["KEYB"] for r in calls] == ["", "100", "200"]
    else:
        assert result["failed"] and result["rows"] == []
    await client.aclose()
