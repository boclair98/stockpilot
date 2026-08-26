"""Background target-price evaluation and Firebase notification delivery."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from decimal import Decimal

import sqlalchemy as sa

from app.core.database import AsyncSessionLocal
from app.core.traffic import traffic_store
from app.models import PriceAlert, PushDevice
from app.services.firebase_push import firebase_push
from app.services.instrument_catalog import Instrument, instrument_catalog
from app.services.kis_market import kis_market

logger = logging.getLogger(__name__)


def reached(direction: str, current: Decimal, target: Decimal) -> bool:
    return (direction == "ABOVE" and current >= target) or (
        direction == "BELOW" and current <= target
    )


def display_money(value: Decimal, currency: str) -> str:
    if currency == "KRW":
        return f"₩{value:,.0f}"
    return f"${value:,.2f}"


class PriceAlertNotifier:
    def __init__(self) -> None:
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if firebase_push.configured and (self._task is None or self._task.done()):
            self._stop.clear()
            self._task = asyncio.create_task(self._run(), name="price-alert-notifier")

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
                # Only one API replica should evaluate and deliver a given
                # alert batch. Redis provides the cross-process lease; the
                # in-memory fallback still keeps local development safe.
                lease = await traffic_store.acquire_lock(
                    "background:price-alert-notifier", ttl_seconds=120
                )
                if lease:
                    await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Price alert background poll failed")
            finally:
                if lease:
                    await traffic_store.release_lock(
                        "background:price-alert-notifier", lease
                    )
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=15)
            except TimeoutError:
                continue

    async def poll_once(self) -> int:
        delivered = 0
        # Read candidates without row locks. Network calls must not hold a
        # database transaction open; the short transactions below re-check
        # each alert before changing its state.
        async with AsyncSessionLocal() as session:
            alerts = (
                (
                    await session.execute(
                        sa.select(PriceAlert)
                        .where(
                            sa.or_(
                                PriceAlert.status == "ACTIVE",
                                sa.and_(
                                    PriceAlert.status == "TRIGGERED",
                                    PriceAlert.notified_at.is_(None),
                                ),
                            )
                        )
                        .order_by(PriceAlert.created_at)
                        .limit(50)
                    )
                )
                .scalars()
                .all()
            )

        # Many users can subscribe to the same popular ticker. Reuse one
        # quote per symbol/exchange within a poll so notification fan-out does
        # not multiply KIS calls by the number of alerts.
        quote_cache: dict[tuple[str, str], tuple[Instrument | None, dict | None]] = {}
        for candidate in alerts:
            quote_key = (candidate.symbol.upper(), candidate.exchange.upper())
            if quote_key not in quote_cache:
                instrument = await instrument_catalog.get(
                    candidate.symbol, exchange=candidate.exchange
                )
                quote = await kis_market.fetch_quote(instrument) if instrument else None
                quote_cache[quote_key] = (instrument, quote)
            instrument, quote = quote_cache[quote_key]
            if not instrument:
                continue
            if not quote or quote.get("price") is None:
                continue
            current = Decimal(str(quote["price"]))
            delivery: tuple[str, str, Decimal, list[str]] | None = None

            async with AsyncSessionLocal.begin() as session:
                alert = (
                    await session.execute(
                        sa.select(PriceAlert)
                        .where(PriceAlert.id == candidate.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if not alert:
                    continue
                target = Decimal(alert.target_price)
                if alert.status == "ACTIVE" and reached(
                    alert.direction, current, target
                ):
                    alert.status = "TRIGGERED"
                    alert.triggered_at = datetime.now(UTC)
                if alert.status != "TRIGGERED" or alert.notified_at is not None:
                    continue
                devices = (
                    (
                        await session.execute(
                            sa.select(PushDevice).where(
                                PushDevice.owner_id == alert.owner_id,
                                PushDevice.enabled.is_(True),
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if devices:
                    delivery = (
                        str(alert.id),
                        alert.direction,
                        target,
                        [device.token for device in devices],
                    )

            if not delivery:
                continue
            alert_id, direction, target, tokens = delivery
            relation = "이상" if direction == "ABOVE" else "이하"
            result = await firebase_push.send(
                tokens,
                title=f"{instrument.name} 목표가 도달",
                body=(
                    f"현재 {display_money(current, instrument.currency)} · "
                    f"설정 가격 {relation} {display_money(target, instrument.currency)}"
                ),
                data={
                    "alertId": alert_id,
                    "symbol": instrument.symbol,
                    "exchange": instrument.exchange,
                    "url": "https://stockpilot.coders.kr/#investor-tools",
                },
            )

            async with AsyncSessionLocal.begin() as session:
                if result.invalid_tokens:
                    await session.execute(
                        sa.delete(PushDevice).where(
                            PushDevice.token.in_(result.invalid_tokens)
                        )
                    )
                if result.success_count:
                    alert = (
                        await session.execute(
                            sa.select(PriceAlert)
                            .where(PriceAlert.id == alert_id)
                            .with_for_update()
                        )
                    ).scalar_one_or_none()
                    if alert and alert.status == "TRIGGERED" and alert.notified_at is None:
                        alert.notified_at = datetime.now(UTC)
                        delivered += result.success_count
        return delivered


price_alert_notifier = PriceAlertNotifier()

