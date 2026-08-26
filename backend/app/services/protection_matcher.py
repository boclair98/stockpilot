"""Background matcher for simulated OCO take-profit/stop-loss protection."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from decimal import Decimal

import sqlalchemy as sa

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.traffic import traffic_store
from app.models import Position, ProtectionPlan, TradeOrder
from app.routes.trading import execute
from app.services.audit import record_audit
from app.services.execution_quality import protection_trigger
from app.services.instrument_catalog import Instrument, instrument_catalog
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
            lease: str | None = None
            try:
                # Keep the matcher singleton across API replicas. Without a
                # distributed lease every pod could trigger the same OCO plan.
                lease = await traffic_store.acquire_lock(
                    "background:protection-matcher", ttl_seconds=120
                )
                if lease:
                    await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Protection matcher poll failed")
            finally:
                if lease:
                    await traffic_store.release_lock(
                        "background:protection-matcher", lease
                    )
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=5)
            except TimeoutError:
                continue

    async def poll_once(self) -> int:
        if settings.trading_mode.upper() != "SIMULATION":
            return 0
        filled = 0
        # Snapshot active plans first. Quote/network work must not hold row
        # locks; each plan is re-validated in a short transaction below.
        async with AsyncSessionLocal() as session:
            control = await load_control(session)
            if control.halted:
                return 0
            plans = (
                (
                    await session.execute(
                        sa.select(ProtectionPlan)
                        .where(ProtectionPlan.status == "ACTIVE")
                        .order_by(ProtectionPlan.created_at)
                        .limit(50)
                    )
                )
                .scalars()
                .all()
            )

        # A single popular ticker may have protection plans for many users.
        # Fetch one quote per symbol/exchange per poll and reuse it for every
        # plan, keeping the KIS rate limiter available for user requests.
        quote_cache: dict[tuple[str, str], tuple[Instrument | None, dict | None]] = {}
        for candidate in plans:
            quote_key = (candidate.symbol.upper(), candidate.exchange.upper())
            if quote_key not in quote_cache:
                instrument = await instrument_catalog.get(
                    candidate.symbol, exchange=candidate.exchange
                )
                quote = (
                    await kis_market.fetch_quote(instrument) if instrument else None
                )
                quote_cache[quote_key] = (instrument, quote)
            instrument, quote = quote_cache[quote_key]
            if not instrument:
                continue
            if not quote or quote.get("price") is None:
                continue
            age = quote_age_seconds(quote)
            if age is None or age > settings.market_data_max_age_seconds:
                continue
            current = Decimal(str(quote["price"]))

            async with AsyncSessionLocal.begin() as session:
                # The global control row is read-only for the matcher. Taking
                # a write lock here would serialize otherwise independent
                # users while operations updates remain atomic themselves.
                control = await load_control(session)
                if control.halted:
                    continue
                plan = (
                    await session.execute(
                        sa.select(ProtectionPlan)
                        .where(
                            ProtectionPlan.id == candidate.id,
                            ProtectionPlan.status == "ACTIVE",
                        )
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if not plan:
                    continue
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


