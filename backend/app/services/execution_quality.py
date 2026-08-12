"""Deterministic, explainable execution quality for simulated stock orders."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation


@dataclass(frozen=True)
class SimulatedFill:
    price: Decimal
    reference_price: Decimal
    spread_bps: Decimal
    slippage_bps: Decimal
    participation_rate: Decimal


def _decimal(value: object, fallback: str = "0") -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(fallback)


def simulated_fill(
    *,
    reference_price: Decimal,
    side: str,
    quantity: Decimal,
    currency: str,
    quote: dict,
    limit_price: Decimal | None = None,
) -> SimulatedFill:
    """Estimate spread and market impact without inventing a random outcome.

    KIS snapshots do not always expose best bid/ask for every watched symbol, so
    the fallback spread is derived from currency and the observed intraday range.
    The same inputs always produce the same fill, which keeps audits reproducible.
    """

    if reference_price <= 0:
        raise ValueError("reference price must be positive")
    volume = max(_decimal(quote.get("volume")), Decimal("0"))
    high = _decimal(quote.get("high"), str(reference_price))
    low = _decimal(quote.get("low"), str(reference_price))
    range_bps = (
        max(Decimal("0"), high - low) / reference_price * Decimal("10000")
    )
    base_spread = Decimal("4") if currency == "KRW" else Decimal("2")
    spread_bps = min(Decimal("35"), base_spread + range_bps * Decimal("0.0125"))
    participation = min(
        Decimal("1"), quantity / max(volume, quantity, Decimal("1"))
    )
    impact_bps = min(
        Decimal("75"),
        Decimal(str(float(participation) ** 0.5)) * Decimal("30"),
    )
    slippage_bps = spread_bps / Decimal("2") + impact_bps
    direction = Decimal("1") if side == "BUY" else Decimal("-1")
    price = reference_price * (
        Decimal("1") + direction * slippage_bps / Decimal("10000")
    )
    if limit_price is not None:
        price = min(price, limit_price) if side == "BUY" else max(price, limit_price)
    tick = Decimal("1") if currency == "KRW" else Decimal("0.01")
    price = price.quantize(tick, rounding=ROUND_HALF_UP)
    return SimulatedFill(
        price=price,
        reference_price=reference_price,
        spread_bps=spread_bps.quantize(Decimal("0.0001")),
        slippage_bps=slippage_bps.quantize(Decimal("0.0001")),
        participation_rate=participation.quantize(Decimal("0.00000001")),
    )


def protection_trigger(
    current: Decimal, take_profit: Decimal, stop_loss: Decimal
) -> str | None:
    if current >= take_profit:
        return "TAKE_PROFIT"
    if current <= stop_loss:
        return "STOP_LOSS"
    return None

