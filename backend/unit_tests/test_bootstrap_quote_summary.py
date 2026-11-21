from datetime import UTC, datetime

import pytest
from app.routes import trading
from fastapi import Response


def test_bootstrap_summary_tracks_market_records_not_request_time():
    created_at = datetime(2026, 11, 21, 12, tzinfo=UTC)
    rows = [
        {"market": "KR", "price": 75000, "asOf": "2026-11-20T15:30:00+09:00"},
        {"market": "KR", "price": 240000, "asOf": "2026-11-20T06:29:00Z"},
        {"market": "US", "price": 219.52, "asOf": "2026-11-20T21:00:00Z"},
        {"market": "US", "price": 205, "asOf": "2026-11-21T12:00:02Z"},
        {"market": "US", "price": 300, "asOf": "2026-11-20T23:00:00"},
        {"market": "KR", "price": 5000, "asOf": "0001-01-01T00:00:00+09:00"},
        {"market": "US", "price": True, "asOf": "2026-11-21T12:00:00Z"},
        {"market": "US", "price": float("nan"), "asOf": "2026-11-21T12:00:00Z"},
        {"market": "KR", "price": 0},
        {"market": "UNKNOWN", "price": 1},
    ]
    assert trading.summarize_bootstrap_quotes(rows, created_at) == {
        "KR": {"count": 3, "latestAt": "2026-11-20T06:30:00+00:00"},
        "US": {"count": 3, "latestAt": "2026-11-20T21:00:00+00:00"},
    }


@pytest.mark.asyncio
async def test_bootstrap_keeps_existing_fields_and_uses_bounded_snapshot(monkeypatch):
    rows = [
        {"market": "KR", "price": 75000, "asOf": "2020-11-20T06:30:00Z"},
        {"market": "KR", "price": 5000, "asOf": "invalid"},
    ]
    calls = []

    async def snapshot(*, top_only):
        calls.append(top_only)
        return rows

    async def cached_index(key):
        assert key == "market:index:kospi"
        return {"indexCode": "KOSPI"}

    monkeypatch.setattr(trading.kis_market, "shared_snapshot", snapshot)
    monkeypatch.setattr(trading.kis_market, "status", lambda: {"connected": False})
    monkeypatch.setattr(trading.traffic_store, "get_json", cached_index)
    response = Response()
    payload = await trading.bootstrap(response)
    assert calls == [True]
    assert payload["quotes"] == rows
    assert payload["kospi"] == {"indexCode": "KOSPI"}
    assert payload["status"] == {"connected": False}
    assert "asOf" in payload
    assert payload["quoteSummary"] == {
        "KR": {"count": 2, "latestAt": "2020-11-20T06:30:00+00:00"},
        "US": {"count": 0, "latestAt": None},
    }
    assert response.headers["cache-control"] == (
        "public, max-age=2, s-maxage=5, stale-while-revalidate=60"
    )
