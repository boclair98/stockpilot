"""Background target-price evaluation and Firebase notification delivery."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from decimal import Decimal

import sqlalchemy as sa

from app.core.database import AsyncSessionLocal
from app.models import PriceAlert, PushDevice
from app.services.firebase_push import firebase_push
from app.services.instrument_catalog import instrument_catalog
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
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Price alert background poll failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=15)
            except TimeoutError:
                continue

    async def poll_once(self) -> int:
        delivered = 0
        async with AsyncSessionLocal.begin() as session:
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
                        .limit(100)
                        .with_for_update(skip_locked=True)
                    )
                )
                .scalars()
                .all()
            )
            for alert in alerts:
                instrument = await instrument_catalog.get(
                    alert.symbol, exchange=alert.exchange
                )
                if not instrument:
                    continue
                quote = await kis_market.fetch_quote(instrument)
                if not quote or quote.get("price") is None:
                    continue
                current = Decimal(str(quote["price"]))
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
                if not devices:
                    continue
                relation = "이상" if alert.direction == "ABOVE" else "이하"
                result = await firebase_push.send(
                    [device.token for device in devices],
                    title=f"{instrument.name} 목표가 도달",
                    body=(
                        f"현재 {display_money(current, instrument.currency)} · "
                        f"설정 가격 {relation} "
                        f"{display_money(target, instrument.currency)}"
                    ),
                    data={
                        "alertId": str(alert.id),
                        "symbol": instrument.symbol,
                        "exchange": instrument.exchange,
                        "url": "https://stockpilot.coders.kr/#investor-tools",
                    },
                )
                if result.invalid_tokens:
                    await session.execute(
                        sa.delete(PushDevice).where(
                            PushDevice.token.in_(result.invalid_tokens)
                        )
                    )
                if result.success_count:
                    alert.notified_at = datetime.now(UTC)
                    delivered += result.success_count
        return delivered


price_alert_notifier = PriceAlertNotifier()
