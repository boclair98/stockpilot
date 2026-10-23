"""Shared price-alert guards; stale or malformed quotes never trigger alerts."""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation


def current_alert_price(
    quote: dict | None, now: datetime | None = None
) -> Decimal | None:
    if not isinstance(quote, dict):
        return None
    try:
        price = Decimal(str(quote["price"]))
        at = datetime.fromisoformat(str(quote["asOf"]).replace("Z", "+00:00"))
        if at.tzinfo is None or not price.is_finite() or price <= 0:
            return None
        age = ((now or datetime.now(UTC)) - at).total_seconds()
        return price if -5 <= age <= 120 else None
    except (KeyError, ValueError, TypeError, InvalidOperation, OverflowError):
        return None
