"""Isolated ASGI/SQLite receipt contract; no market or production database calls."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from app.core.config import settings
from app.core.database import get_session
from app.models import AuditEvent, TradeOrder, TradingAccount, TradingControl
from app.routes import trading
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.orm import Session


class LocalSession:
    def __init__(self, sync):
        self.sync = sync

    async def execute(self, statement):
        return self.sync.execute(statement)

    async def scalar(self, statement):
        return self.sync.scalar(statement)

    async def flush(self):
        self.sync.flush()

    def add(self, row):
        self.sync.add(row)

    @asynccontextmanager
    async def begin_nested(self):
        with self.sync.begin_nested():
            yield


@pytest.mark.asyncio
async def test_triggered_stop_limit_persists_as_unfilled_and_can_be_cancelled(monkeypatch):
    owner = uuid4()
    monkeypatch.setattr(settings, "trading_mode", "SIMULATION")
    monkeypatch.setattr(settings, "market_data_max_age_seconds", 60)
    monkeypatch.setattr(settings, "risk_max_price_deviation_percent", Decimal("10"))

    async def instrument(symbol, market, exchange):
        assert (symbol, market, exchange) == ("AAPL", "US", "NAS")
        return SimpleNamespace(exchange="NAS", currency="USD")

    async def quote(_instrument):
        return {"price": 101, "asOf": datetime.now(UTC).isoformat()}

    async def never_fill(*_args, **_kwargs):
        pytest.fail("A triggered BUY must not fill above its limit")

    monkeypatch.setattr(trading.instrument_catalog, "get", instrument)
    monkeypatch.setattr(trading.kis_market, "fetch_quote", quote)
    monkeypatch.setattr(trading, "execute", never_fill)
    engine = sa.create_engine("sqlite://")
    try:
        for model in (AuditEvent, TradeOrder, TradingAccount, TradingControl):
            model.__table__.create(engine)
        with Session(engine) as sync, sync.begin():
            sync.add(TradingAccount(owner_id=owner, cash=1000, cash_krw=0))
            sync.add(
                TradingControl(
                    scope="GLOBAL",
                    max_order_notional_krw=1000000,
                    max_order_notional_usd=10000,
                    max_open_orders=20,
                    max_daily_orders=200,
                )
            )

        async def database(request: Request):
            request.state.request_id = "stop-limit-receipt-fixture"
            with Session(engine) as sync, sync.begin():
                yield LocalSession(sync)

        async def identity():
            return owner

        app = FastAPI()
        app.include_router(trading.router)
        app.dependency_overrides[get_session] = database
        app.dependency_overrides[trading.require_practice_identity] = identity
        key = "stop-limit-receipt-fixture"
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            order = await client.post(
                "/api/trading/orders",
                headers={"Idempotency-Key": key},
                json={
                    "symbol": "AAPL",
                    "market": "US",
                    "exchange": "NAS",
                    "side": "BUY",
                    "orderType": "STOP_LIMIT",
                    "quantity": 1,
                    "limitPrice": 100,
                    "triggerPrice": 100,
                },
            )
            assert order.status_code == 201
            receipt = order.json()
            assert (receipt["status"], receipt["fillPrice"]) == ("TRIGGERED", None)

            recovered = await client.get(f"/api/trading/orders/request/{key}")
            assert recovered.status_code == 200
            assert recovered.json() == {**receipt, "replayed": True}

            canceled = await client.delete(f"/api/trading/orders/{receipt['id']}")
            assert canceled.status_code == 200
            assert canceled.json()["status"] == "CANCELED"
        with Session(engine) as sync:
            persisted = sync.scalars(sa.select(TradeOrder)).one()
            assert (persisted.status, persisted.fill_price) == ("CANCELED", None)
            assert sync.get(TradingAccount, owner).cash == Decimal("1000")
            audit_events = sync.scalars(sa.select(AuditEvent.event_type)).all()
            assert sorted(audit_events) == ["ORDER_ACCEPTED", "ORDER_CANCELED"]
    finally:
        engine.dispose()
