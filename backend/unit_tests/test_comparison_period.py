"""Pure saved-comparison canonicalization; no database, account, or market writes."""

import pytest
from app.routes import personal
from app.services.instrument_catalog import Instrument
from fastapi import HTTPException


@pytest.fixture
def comparison(monkeypatch):
    rows = [
        Instrument("005930", "검증 한국 종목", "KR", "KRW", "KRX", "Korean fixture"),
        Instrument("AAPL", "검증 미국 종목", "US", "USD", "NAS", "US fixture"),
    ]
    calls = []

    async def lookup(symbol, exchange, market=None):
        calls.append((symbol, exchange, market))
        return next(
            row
            for row in rows
            if (row.symbol, row.exchange, row.market) == (symbol, exchange, market)
        )

    monkeypatch.setattr(personal, "instrument", lookup)
    return ",".join(row.id for row in rows), {
        "instruments": [row.public() for row in rows],
        "note": "개인 메모는 비공개 계정 저장에만 포함",
        "cash": "must be stripped",
    }, calls


@pytest.mark.parametrize("days", [5, 20, 60])
async def test_saved_period_is_explicit_allowlisted_and_preserves_identity(comparison, days):
    key, data, calls = comparison
    result = await personal.canonical_saved("COMPARE", key, {**data, "days": days})
    assert result["days"] == days
    assert result["id"] == key
    assert result["note"] == data["note"]
    assert set(result) == {"id", "name", "instruments", "note", "days"}
    assert len(calls) == 2


async def test_old_saved_request_defaults_to_twenty_days(comparison):
    key, data, _ = comparison
    result = await personal.canonical_saved("COMPARE", key, data)
    assert result["days"] == 20


@pytest.mark.parametrize("days", [0, 1, 6, 19, 21, 365, -5, 20.0, "20", None, True, False, [], {}])
async def test_invalid_saved_period_is_rejected_before_catalog_reads(comparison, days):
    key, data, calls = comparison
    with pytest.raises(HTTPException) as error:
        await personal.canonical_saved("COMPARE", key, {**data, "days": days})
    assert error.value.status_code == 422
    assert calls == []


async def test_period_does_not_weaken_comparison_identity_validation(comparison):
    key, data, _ = comparison
    with pytest.raises(HTTPException) as error:
        await personal.canonical_saved("COMPARE", key + ",private", {**data, "days": 60})
    assert error.value.status_code == 422
