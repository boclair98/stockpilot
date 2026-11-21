"""Reservation aggregation: isolated SQLite locally, PostgreSQL in the quality gate."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from app.models import Position, ProtectionPlan, TradeOrder, TradingAccount
from app.routes import trading
from fastapi import Request
from sqlalchemy.ext.asyncio import async_sessionmaker

from tests import test_personal_tools as fixtures

store = fixtures.store


async def _assert_grouped_portfolio_capacity(session, monkeypatch):
    owner, other = uuid4(), uuid4()
    old = datetime(2026, 1, 1, tzinfo=UTC)
    for account_owner in (owner, other):
        session.add(TradingAccount(owner_id=account_owner, cash=100, cash_krw=1000))
    for code, venue, quantity in (
        ("005930", "KRX", "10.123456"),
        ("005930", "NXT", "3"),
        ("000660", "KRX", "2"),
    ):
        session.add(
            Position(
                owner_id=owner,
                symbol=code,
                exchange=venue,
                quantity=Decimal(quantity),
                average_price=10,
            )
        )
    session.add(
        Position(
            owner_id=other,
            symbol="005930",
            exchange="KRX",
            quantity=100,
            average_price=10,
        )
    )

    def order(quantity, status, *, age=0, owner_id=owner, exchange="KRX", side="SELL"):
        item = TradeOrder(
            owner_id=owner_id,
            symbol="005930",
            exchange=exchange,
            side=side,
            order_type="LIMIT",
            quantity=Decimal(quantity),
            status=status,
            created_at=old + timedelta(minutes=age),
        )
        session.add(item)
        return item

    def protection(quantity, status, *, age=0, owner_id=owner, exchange="KRX"):
        item = ProtectionPlan(
            owner_id=owner_id,
            symbol="005930",
            exchange=exchange,
            quantity=Decimal(quantity),
            take_profit_price=120,
            stop_loss_price=80,
            status=status,
            created_at=old + timedelta(minutes=age),
        )
        session.add(item)
        return item

    pending = order("6.25", "OPEN")
    triggered = order("1.125", "TRIGGERED", age=1)
    order(75, "CANCELED")
    order(75, "OPEN", side="BUY")
    order(75, "REJECTED")
    order(75, "OPEN", owner_id=other)
    order(4, "OPEN", exchange="NXT")
    active = protection("0.5", "ACTIVE")
    protection(75, "TRIGGERED")
    protection(75, "ACTIVE", owner_id=other)
    protection(1, "ACTIVE", exchange="NXT")
    for age in range(2, 35):
        order(1, "FILLED", age=age)
        protection(1, "CANCELED", age=age)
    await session.flush()

    async def skip_processing(*_args):
        pass  # Keep reservation histories fixed; mutation paths are not under test.

    async def instrument(symbol, exchange):
        return SimpleNamespace(
            name=symbol,
            market="KR",
            currency="KRW",
            public=lambda: {},
        )

    monkeypatch.setattr(trading, "process_open_orders", skip_processing)
    monkeypatch.setattr(trading, "record_daily_snapshot", skip_processing)
    monkeypatch.setattr(trading.instrument_catalog, "get", instrument)
    monkeypatch.setattr(trading.kis_market, "watch", skip_processing)
    monkeypatch.setattr(trading.kis_market, "quote", lambda *_: None)

    statements = []
    original_execute = session.execute

    async def track_execute(statement):
        statements.append(statement)
        return await original_execute(statement)

    monkeypatch.setattr(session, "execute", track_execute)
    result = await trading.portfolio(
        Request({"type": "http", "headers": []}), owner, session
    )
    assert result["positionCoverageComplete"] is True
    assert result["cash"] == {"KRW": 1000, "USD": 100}
    by_position = {
        (row["symbol"], row["exchange"]): row["sellCapacity"]
        for row in result["positions"]
    }
    assert by_position == {
        ("005930", "KRX"): {
            "pendingOrderQuantity": 7.375,
            "protectionQuantity": 0.5,
            "availableQuantity": 2.248456,
        },
        ("005930", "NXT"): {
            "pendingOrderQuantity": 4,
            "protectionQuantity": 1,
            "availableQuantity": 0,  # Never display negative availability.
        },
        ("000660", "KRX"): {
            "pendingOrderQuantity": 0,
            "protectionQuantity": 0,
            "availableQuantity": 2,
        },
    }
    assert len(result["orders"]) == len(result["protections"]) == 30
    assert {str(pending.id), str(triggered.id)}.isdisjoint(
        {row["id"] for row in result["orders"]}
    )
    assert str(active.id) not in {row["id"] for row in result["protections"]}
    assert len(statements) == 4  # Existing account, positions, orders and protections.
    assert all(isinstance(statement, sa.Select) for statement in statements)
    held, reserved = await trading.sell_capacity(session, owner, "005930", "KRX")
    assert (held, reserved) == (Decimal("10.123456"), Decimal("7.875"))


@pytest.mark.no_db
async def test_sqlite_portfolio_uses_all_reservations_in_one_position_read(
    store, monkeypatch
):
    await _assert_grouped_portfolio_capacity(store, monkeypatch)


async def test_postgres_portfolio_uses_all_reservations_in_one_position_read(
    _engine, monkeypatch
):
    make_session = async_sessionmaker(_engine, expire_on_commit=False)
    async with make_session() as session:
        try:
            await _assert_grouped_portfolio_capacity(session, monkeypatch)
        finally:
            await session.rollback()
