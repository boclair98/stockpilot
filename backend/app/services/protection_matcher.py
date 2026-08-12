"""Background matcher for simulated OCO take-profit/stop-loss protection."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from decimal import Decimal

import sqlalchemy as sa

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import Position, ProtectionPlan, TradeOrder
from app.routes.trading import execute
from app.services.audit import record_audit
from app.services.execution_quality import protection_trigger
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market
from app.services.risk_engine import load_control, quote_age_seconds

logger = logging.getLogger(__name__)


class ProtectionMatcher:
    def __init__(self) -> None:
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop.clear()
            self._task = asyncio.create_task(
                self._run(), name="simulation-protection-matcher"
            )

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Protection matcher poll failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=5)
            except TimeoutError:
                continue

    async def poll_once(self) -> int:
        if settings.trading_mode.upper() != "SIMULATION":
            return 0
        filled = 0
        async with AsyncSessionLocal.begin() as session:
            control = await load_control(session)
            if control.halted:
                return 0
            plans = (
                (
                    await session.execute(
                        sa.select(ProtectionPlan)
                        .where(ProtectionPlan.status == "ACTIVE")
                        .order_by(ProtectionPlan.created_at)
                        .limit(100)
                        .with_for_update(skip_locked=True)
                    )
                )
                .scalars()
                .all()
            )
            for plan in plans:
                instrument = await instrument_catalog.get(
                    plan.symbol, exchange=plan.exchange
                )
                if not instrument:
                    continue
                quote = kis_market.quote(plan.symbol, exchange=plan.exchange)
                if not quote:
                    await kis_market.watch(instrument)
                    quote = await kis_market.fetch_quote(instrument)
                if not quote or quote.get("price") is None:
                    continue
                age = quote_age_seconds(quote)
                if age is None or age > settings.market_data_max_age_seconds:
                    continue
                current = Decimal(str(quote["price"]))
                reason = protection_trigger(
                    current,
                    Decimal(plan.take_profit_price),
                    Decimal(plan.stop_loss_price),
                )
                if not reason:
                    continue
                position = (
                    await session.execute(
                        sa.select(Position)
                        .where(
                            Position.owner_id == plan.owner_id,
                            Position.symbol == plan.symbol,
                            Position.exchange == plan.exchange,
                        )
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if not position or Decimal(position.quantity) < Decimal(plan.quantity):
                    plan.status = "FAILED"
                    plan.trigger_reason = reason
                    plan.triggered_at = datetime.now(UTC)
                    record_audit(
                        session,
                        actor_id=plan.owner_id,
                        event_type="PROTECTION_FAILED",
                        entity_id=plan.id,
                        request_id=f"protection:{plan.id}",
                        details={"reason": "INSUFFICIENT_POSITION"},
                    )
                    continue
                # Remove this plan's own reservation before the simulated sell
                # capacity check. The row lock keeps cancellation and duplicate
                # matcher workers from racing with this state transition.
                plan.status = "TRIGGERED"
                plan.trigger_reason = reason
                plan.triggered_at = datetime.now(UTC)
                await session.flush()
                order = TradeOrder(
                    owner_id=plan.owner_id,
                    symbol=plan.symbol,
                    exchange=plan.exchange,
                    side="SELL",
                    order_type="PROTECTION",
                    quantity=plan.quantity,
                    trigger_price=(
                        plan.take_profit_price
                        if reason == "TAKE_PROFIT"
                        else plan.stop_loss_price
                    ),
                    status="OPEN",
                )
                session.add(order)
                await session.flush()
                await execute(session, order, instrument, current, quote)
                plan.status = "FILLED" if order.status == "FILLED" else "FAILED"
                plan.exit_order_id = order.id
                record_audit(
                    session,
                    actor_id=plan.owner_id,
                    event_type=(
                        "PROTECTION_FILLED"
                        if order.status == "FILLED"
                        else "PROTECTION_FAILED"
                    ),
                    entity_id=plan.id,
                    request_id=f"protection:{plan.id}",
                    details={
                        "reason": reason,
                        "referencePrice": str(current),
                        "fillPrice": str(order.fill_price),
                        "orderId": str(order.id),
                    },
                )
                if order.status == "FILLED":
                    filled += 1
        return filled


protection_matcher = ProtectionMatcher()

