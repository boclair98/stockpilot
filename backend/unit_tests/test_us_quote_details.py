import httpx
import pytest
from app.core.config import settings
from app.core.traffic import traffic_store
from app.routes.trading import quote_details, router
from app.services.kis_market import TOP_INSTRUMENTS, KISMarket
from app.services.us_quote_details import normalize_us_details
from fastapi import FastAPI, HTTPException, Response


def fixture():
    return {
        "curr": "USD",
        "last": "200",
        "shar": "1000000000",
        "tomv": "200000000000",
        "open": "198",
        "high": "205",
        "low": "195",
        "base": "199",
        "h52p": "250",
        "l52p": "100",
        "perx": "-5",
        "pbrx": "0",
    }


def test_market_cap_uses_verified_tomv_and_usd_not_capital_stock():
    output = fixture()
    output["mcap"] = "12345"
    result = normalize_us_details(output, "AAPL", "NAS")
    assert result["marketCapUsd"] == 200_000_000_000
    assert result["currency"] == "USD"
    assert result["open"] == 198
    assert result["per"] is None


def test_million_unit_is_cross_checked_not_guessed():
    output = fixture()
    output["tomv"] = "200000"
    assert (
        normalize_us_details(output, "AAPL", "NAS")["marketCapUsd"] == 200_000_000_000
    )
    output["tomv"] = "1"
    assert normalize_us_details(output, "AAPL", "NAS")["marketCapUsd"] is None


@pytest.mark.parametrize("value", [None, "", "NaN", "Infinity", "-100", "1e999", "0"])
def test_invalid_values_never_turn_into_zero_prices_or_guessed_caps(value):
    output = fixture()
    output["shar"] = value
    output["high"] = value
    result = normalize_us_details(output, "AAPL", "NAS")
    assert result["marketCapUsd"] is None
    assert result["high"] is None


def test_inverted_ranges_are_unknown():
    output = fixture()
    output.update({"low": "300", "h52p": "90"})
    result = normalize_us_details(output, "AAPL", "NAS")
    assert result["low"] is None and result["high"] is None
    assert result["week52Low"] is None and result["week52High"] is None


def test_other_currencies_cannot_be_labelled_usd():
    with pytest.raises(ValueError):
        normalize_us_details({**fixture(), "curr": "HKD"}, "AAPL", "NAS")


@pytest.mark.asyncio
async def test_optional_details_do_not_fetch_for_domestic_or_unconfigured(monkeypatch):
    market = KISMarket()
    monkeypatch.setattr(settings, "kis_app_key", None)
    assert await market.us_quote_details(TOP_INSTRUMENTS[0]) is None


@pytest.mark.asyncio
async def test_upstream_failure_is_optional_and_does_not_change_execution_quote(
    monkeypatch,
):
    market = KISMarket()
    us = next(item for item in TOP_INSTRUMENTS if item.market == "US")
    market._store(us, "200", "1", "0.5", "REST")
    monkeypatch.setattr(settings, "kis_app_key", "test")
    monkeypatch.setattr(settings, "kis_app_secret", "test")

    async def unavailable(*args):
        raise ValueError("upstream unavailable")

    monkeypatch.setattr(traffic_store, "get_or_set", unavailable)
    assert await market.us_quote_details(us) is None
    assert market.quote(us.symbol, us.market, us.exchange)["price"] == 200


@pytest.mark.asyncio
async def test_details_route_rejects_invalid_market_exchange_and_long_symbols():
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for params in [
            {"symbol": "AAPL", "market": "KR", "exchange": "NAS"},
            {"symbol": "AAPL", "market": "US", "exchange": "KRX"},
            {"symbol": "A" * 13, "market": "US", "exchange": "NAS"},
        ]:
            response = await client.get("/api/trading/quote-details", params=params)
            assert response.status_code == 422


@pytest.mark.asyncio
async def test_details_route_has_safe_failure_and_public_data_cache(monkeypatch):
    from app.routes.trading import instrument_catalog, kis_market

    us = next(item for item in TOP_INSTRUMENTS if item.market == "US")

    async def catalog(*args):
        return us

    async def unavailable(*args):
        return None

    monkeypatch.setattr(instrument_catalog, "get", catalog)
    monkeypatch.setattr(kis_market, "us_quote_details", unavailable)
    with pytest.raises(HTTPException) as error:
        await quote_details(Response(), us.symbol, "US", us.exchange)
    assert error.value.status_code == 503
    assert error.value.headers["Cache-Control"] == "no-store"

    async def available(*args):
        return normalize_us_details(fixture(), us.symbol, us.exchange)

    monkeypatch.setattr(kis_market, "us_quote_details", available)
    response = Response()
    body = await quote_details(response, us.symbol, "US", us.exchange)
    assert body["marketCapUsd"] > 0
    assert "public" in response.headers["Cache-Control"]
