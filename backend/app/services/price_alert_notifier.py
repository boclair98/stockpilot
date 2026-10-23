"""Background target-price evaluation and Firebase notification delivery."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa

from app.core.database import AsyncSessionLocal
from app.core.traffic import traffic_store
from app.models import PriceAlert, PushDevice
from app.services.firebase_push import firebase_push
from app.services.instrument_catalog import Instrument, instrument_catalog
from app.services.kis_market import kis_market
from app.services.price_alerts import current_alert_price

logger = logging.getLogger(__name__)
CURSOR_KEY = "background:price-alert-cursor:v1"


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
        # In-app alerts remain useful even when web-push credentials are absent.
        if self._task is None or self._task.done():
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
                    # Finish before the 120-second lease expires; never allow a
                    # slow symbol to retain leadership indefinitely.
                    await asyncio.wait_for(self.poll_once(), timeout=90)
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
        cursor = await traffic_store.get_json(CURSOR_KEY)
        position = None
        if cursor:
            try:
                at = datetime.fromisoformat(cursor["at"])
                if at.tzinfo is None:
                    raise ValueError
                position = (at, UUID(cursor["id"]))
            except (KeyError, TypeError, ValueError):
                position = None
        # Triggered alerts with no enabled device need no delivery attempt yet.
        # They become candidates again if the owner registers a device later.
        pending_delivery = (
            sa.and_(
                PriceAlert.status == "TRIGGERED",
                PriceAlert.notified_at.is_(None),
                sa.exists().where(
                    PushDevice.owner_id == PriceAlert.owner_id,
                    PushDevice.enabled.is_(True),
                ),
            )
            if firebase_push.configured
            else sa.false()
        )
        eligible = sa.or_(PriceAlert.status == "ACTIVE", pending_delivery)

        def page(after):
            conditions = [eligible]
            if after:
                at, identity = after
                conditions.append(
                    sa.or_(
                        PriceAlert.created_at > at,
                        sa.and_(PriceAlert.created_at == at, PriceAlert.id > identity),
                    )
                )
            return (
                sa.select(PriceAlert)
                .where(*conditions)
                .order_by(PriceAlert.created_at, PriceAlert.id)
                .limit(50)
            )

        # Read candidates without row locks. Network calls must not hold a
        # database transaction open; the short transactions below re-check
        # each alert before changing its state.
        async with AsyncSessionLocal() as session:
            alerts = (await session.execute(page(position))).scalars().all()
            if not alerts and position:
                # Wrap around after the final page so unmet old alerts are also
                # checked again, without starving new users behind the first50.
                alerts = (await session.execute(page(None))).scalars().all()

        # Many users can subscribe to the same popular ticker. Reuse one
        # quote per symbol/exchange within a poll so notification fan-out does
        # not multiply KIS calls by the number of alerts.
        quote_cache: dict[tuple[str, str], tuple[Instrument | None, dict | None]] = {}
        for candidate in alerts:
            at = candidate.created_at
            if at.tzinfo is None:
                at = at.replace(tzinfo=UTC)
            # Persist progress before external I/O. Timeout/failing symbols are
            # retried on the next sweep, not at the expense of every later row.
            await traffic_store.set_json(
                CURSOR_KEY,
                {"at": at.isoformat(), "id": str(candidate.id)},
                ttl=86400,
            )
            try:
                delivered += await self._check(candidate, quote_cache)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Price alert skipped this sweep: %s", type(exc).__name__)
        return delivered

    async def _check(self, candidate, quote_cache) -> int:
        quote_key = (candidate.symbol.upper(), candidate.exchange.upper())
        if quote_key not in quote_cache:
            # A missing catalog row or failed quote cannot consume the entire
            # batch. Cache failures too, avoiding repeated calls for one ticker.
            quote_cache[quote_key] = (None, None)

            async def fetch():
                instrument = await instrument_catalog.get(
                    candidate.symbol,
                    exchange=candidate.exchange,
                )
                quote = await kis_market.fetch_quote(instrument) if instrument else None
                return instrument, quote

            quote_cache[quote_key] = await asyncio.wait_for(fetch(), timeout=10)
        instrument, quote = quote_cache[quote_key]
        current = current_alert_price(quote)
        if not instrument or current is None:
            return 0
        delivery = None
        async with AsyncSessionLocal.begin() as session:
            alert = (
                await session.execute(
                    sa.select(PriceAlert)
                    .where(PriceAlert.id == candidate.id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if not alert:
                return 0
            target = Decimal(alert.target_price)
            if alert.status == "ACTIVE" and reached(alert.direction, current, target):
                alert.status = "TRIGGERED"
                alert.triggered_at = datetime.now(UTC)
            if (
                alert.status != "TRIGGERED"
                or alert.notified_at is not None
                or not firebase_push.configured
            ):
                return 0
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
                    alert.id,
                    alert.direction,
                    target,
                    [device.token for device in devices],
                )
        if not delivery:
            return 0
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
                "alertId": str(alert_id),
                "symbol": instrument.symbol,
                "exchange": instrument.exchange,
                "url": "https://stockpilot.coders.kr/#investor-tools",
            },
        )
        async with AsyncSessionLocal.begin() as session:
            if result.invalid_tokens:
                await session.execute(
                    sa.delete(PushDevice).where(
                        PushDevice.token.in_(result.invalid_tokens),
                    )
                )
            if result.success_count:
                alert = (
                    await session.execute(
                        sa.select(PriceAlert)
                        .where(
                            PriceAlert.id == alert_id,
                        )
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if alert and alert.status == "TRIGGERED" and alert.notified_at is None:
                    alert.notified_at = datetime.now(UTC)
                    return result.success_count
        return 0


price_alert_notifier = PriceAlertNotifier()
