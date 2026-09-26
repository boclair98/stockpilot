"""Pure invariants of the fictional market; no live market API is needed."""

import pytest
from app.main import app
from app.routes.toss_game import INSTRUMENTS, fictional_price, game_index, quote
from httpx import ASGITransport, AsyncClient


def test_fictional_price_is_repeatable_and_positive():
    for symbol in ("005930", "NVDA", "AAPL"):
        first = fictional_price(symbol, 60_000_000)
        assert first == fictional_price(symbol, 60_000_000)
        assert first > 0
        assert any(first != fictional_price(symbol, 60_000_000 + offset) for offset in range(1, 11))


def test_quote_never_looks_like_market_volume_or_capitalization():
    row = quote(INSTRUMENTS["005930"], 60_000_000)
    assert row["isFictional"] is True
    assert row["market"] == "KR"
    assert "volume" not in row
    assert "marketCapEok" not in row
    assert row["price"] > 0


def test_game_index_is_explicitly_not_kospi():
    index = game_index(60_000_000)
    assert index["name"] == "가상시장 지수"
    assert len(index["points"]) == 21


@pytest.mark.asyncio
async def test_public_game_api_never_returns_real_market_fields():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/toss-game/bootstrap")
        assert response.status_code == 200
        data = response.json()
        assert data["mode"] == "FICTIONAL"
        assert data["kospi"]["name"] == "가상시장 지수"
        assert len(data["quotes"]) == 20
        assert all(row["isFictional"] and "volume" not in row and "marketCapEok" not in row for row in data["quotes"])
        found = await client.get("/api/toss-game/search", params={"q": "삼성"})
        assert found.status_code == 200
        assert found.json()["items"]
