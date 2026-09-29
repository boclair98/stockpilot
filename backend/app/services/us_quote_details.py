"""Optional US fundamentals; never a source for order execution prices."""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation


def positive(value: object) -> Decimal | None:
    try:
        number = Decimal(str(value).replace(",", ""))
        return number if number.is_finite() and 0 < number < Decimal("1e20") else None
    except (InvalidOperation, ValueError):
        return None


def normalize_us_details(output: dict, symbol: str, exchange: str) -> dict:
    """Cross-check KIS market cap units against price × listed shares.

    Missing, non-finite, or inconsistent values stay unknown. In particular,
    mcap (capital stock) must NEVER be substituted for tomv (market cap).
    """
    if str(output.get("curr", "")).upper() != "USD":
        raise ValueError("Only USD quote details are supported")
    price, shares, raw_cap = (
        positive(output.get(key)) for key in ("last", "shar", "tomv")
    )
    cap = None
    if price and shares and raw_cap and shares == shares.to_integral_value():
        expected = price * shares
        for scale in (Decimal(1), Decimal(1_000_000)):
            candidate = raw_cap * scale
            if abs(candidate - expected) / expected <= Decimal("0.03"):
                cap = candidate
                break
    result = {
        "symbol": symbol,
        "exchange": exchange,
        "currency": "USD",
        "asOf": datetime.now(UTC).isoformat(),
        "source": "한국투자증권 KIS 해외주식 현재가상세",
        "marketCapUsd": float(cap) if cap else None,
        "marketCapMethod": "KIS tomv · 가격×상장주수 단위 교차검증" if cap else None,
        "listedShares": float(shares)
        if shares and shares == shares.to_integral_value()
        else None,
    }
    for target, key in {
        "open": "open",
        "high": "high",
        "low": "low",
        "previousClose": "base",
        "week52High": "h52p",
        "week52Low": "l52p",
        "per": "perx",
        "pbr": "pbrx",
    }.items():
        value = positive(output.get(key))
        result[target] = float(value) if value else None
    for low, high in (("low", "high"), ("week52Low", "week52High")):
        if result[low] and result[high] and result[low] > result[high]:
            result[low] = result[high] = None
    return result
