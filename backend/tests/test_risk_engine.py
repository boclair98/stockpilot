from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from app.core.config import settings
from app.services import risk_engine
from app.services.risk_engine import assess_pretrade, quote_age_seconds

pytestmark = pytest.mark.no_db


def test_quote_age_accepts_current_iso_timestamp():
    now = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)
    quote = {"asOf": (now - timedelta(seconds=4)).isoformat()}
    assert quote_age_seconds(quote, now) == pytest.approx(4)


def test_quote_age_fails_closed_for_missing_or_invalid_timestamp():
    assert quote_age_seconds({}) is None
    assert quote_age_seconds({"asOf": "not-a-date"}) is None


def test_future_timestamp_does_not_create_negative_age():
    now = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)
    quote = {"asOf": (now + timedelta(seconds=2)).isoformat()}
    assert quote_age_seconds(quote, now) == 0


class FakeSession:
    def __init__(self, scalar_values=()):
        self.scalar_values = iter(scalar_values)

    async def scalar(self, _query):
        return next(self.scalar_values)


def control(**overrides):
    values = {
        "halted": False,
        "halt_reason": None,
        "max_order_notional_krw": Decimal("100000000"),
        "max_order_notional_usd": Decimal("100000"),
        "max_open_orders": 20,
        "max_daily_orders": 200,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


async def decision(
    monkeypatch,
    *,
    quote=None,
    active_control=None,
    scalar_values=(0, 0),
    **values,
):
    async def fake_load_control(_session, *, lock=False):
        return active_control or control()

    monkeypatch.setattr(risk_engine, "load_control", fake_load_control)
    payload = {
        "owner": uuid4(),
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": Decimal("1"),
        "currency": "KRW",
        "quote": quote or {"price": 1000, "asOf": datetime.now(UTC).isoformat()},
        "limit_price": None,
        "trigger_price": None,
    }
    payload.update(values)
    return await assess_pretrade(FakeSession(scalar_values), **payload)


async def test_pretrade_fails_closed_outside_simulation(monkeypatch):
    monkeypatch.setattr(settings, "trading_mode", "LIVE")
    result = await decision(monkeypatch)
    assert not result.allowed
    assert result.code == "UNAPPROVED_TRADING_MODE"


async def test_pretrade_honors_global_kill_switch(monkeypatch):
    result = await decision(
        monkeypatch,
        active_control=control(halted=True, halt_reason="운영 점검"),
    )
    assert not result.allowed
    assert result.code == "GLOBAL_HALT"
    assert result.message == "운영 점검"


async def test_pretrade_rejects_stale_quotes(monkeypatch):
    result = await decision(
        monkeypatch,
        quote={
            "price": 1000,
            "asOf": (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
        },
    )
    assert not result.allowed
    assert result.code == "STALE_MARKET_DATA"


async def test_pretrade_enforces_notional_and_price_collar(monkeypatch):
    too_large = await decision(monkeypatch, quantity=Decimal("1000000"))
    assert too_large.code == "MAX_ORDER_NOTIONAL"

    collar = await decision(
        monkeypatch,
        order_type="LIMIT",
        limit_price=Decimal("2000"),
    )
    assert collar.code == "PRICE_COLLAR"


async def test_pretrade_enforces_open_and_daily_order_limits(monkeypatch):
    open_limit = await decision(monkeypatch, scalar_values=(20, 0))
    assert open_limit.code == "MAX_OPEN_ORDERS"

    daily_limit = await decision(monkeypatch, scalar_values=(0, 200))
    assert daily_limit.code == "MAX_DAILY_ORDERS"


async def test_pretrade_approves_order_within_all_limits(monkeypatch):
    result = await decision(monkeypatch)
    assert result.allowed
    assert result.code == "APPROVED"
