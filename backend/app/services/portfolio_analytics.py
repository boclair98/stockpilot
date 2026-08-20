"""Explainable portfolio analytics for the simulation dashboard.

The calculation layer intentionally accepts small immutable records instead of
SQLAlchemy models. That keeps the financial math deterministic, easy to test,
and safe to reuse from a background job or a future export endpoint.

All return-rate values are percentage points (``5`` means ``+5%``), matching
the representation used by ``PortfolioDailySnapshot``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from math import sqrt
from statistics import fmean, pstdev


@dataclass(frozen=True)
class SnapshotPoint:
    day: date
    return_rate: Decimal


@dataclass(frozen=True)
class ExecutionPoint:
    side: str
    status: str
    realized_pnl: Decimal | None = None
    slippage_bps: Decimal | None = None
    spread_bps: Decimal | None = None


def _round(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None else None


def _drawdown_series(values: list[float]) -> tuple[float, float]:
    peak = values[0]
    max_drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        max_drawdown = max(max_drawdown, peak - value)
    return peak, max_drawdown


def build_portfolio_analytics(
    snapshots: list[SnapshotPoint],
    executions: list[ExecutionPoint],
    open_position_count: int = 0,
) -> dict:
    """Build a portfolio-health snapshot without exposing holdings.

    ``dailyChanges`` is derived from the return-rate curve rather than from
    cash movements. This makes the metric comparable across KRW and USD
    accounts and avoids treating deposits as investment performance.
    """

    ordered = sorted(snapshots, key=lambda point: point.day)
    values = [float(point.return_rate) for point in ordered]
    changes = [right - left for left, right in zip(values, values[1:])]
    _, max_drawdown = _drawdown_series(values) if values else (0.0, 0.0)

    average_change = fmean(changes) if changes else None
    daily_volatility = pstdev(changes) if len(changes) >= 2 else None
    annualized_volatility = daily_volatility * sqrt(252) if daily_volatility is not None else None
    sharpe = (
        average_change / daily_volatility * sqrt(252)
        if average_change is not None and daily_volatility and daily_volatility > 0
        else None
    )

    sell_results = [
        float(item.realized_pnl)
        for item in executions
        if (
            item.side.upper() == "SELL"
            and item.status.upper() == "FILLED"
            and item.realized_pnl is not None
        )
    ]
    wins = [value for value in sell_results if value > 0]
    losses = [value for value in sell_results if value < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    fill_candidates = [
        item
        for item in executions
        if item.status.upper() in {"FILLED", "REJECTED", "CANCELED"}
    ]
    filled_count = sum(1 for item in fill_candidates if item.status.upper() == "FILLED")
    slippage = [
        float(item.slippage_bps)
        for item in executions
        if item.slippage_bps is not None and item.status.upper() == "FILLED"
    ]
    spread = [
        float(item.spread_bps)
        for item in executions
        if item.spread_bps is not None and item.status.upper() == "FILLED"
    ]

    series = [
        {
            "date": point.day.isoformat(),
            "returnRate": round(float(point.return_rate), 4),
            "change": round(changes[index - 1], 4) if index else None,
        }
        for index, point in enumerate(ordered[-30:])
    ]
    # The change above is relative to the full ordered curve, including the
    # point immediately before the visible 30-day window.
    start_index = max(0, len(ordered) - 30)
    for index, item in enumerate(series):
        source_index = start_index + index
        item["change"] = round(changes[source_index - 1], 4) if source_index else None

    return {
        "dataQuality": "TRACKING" if len(ordered) >= 2 else "STARTING",
        "periodDays": len(ordered),
        "openPositionCount": open_position_count,
        "totalReturn": _round(values[-1] if values else None),
        "maxDrawdown": _round(max_drawdown),
        "dailyVolatility": _round(daily_volatility),
        "annualizedVolatility": _round(annualized_volatility),
        "sharpeRatio": _round(sharpe),
        "winRate": _round((len(wins) / len(sell_results) * 100) if sell_results else None),
        "profitFactor": _round(
            (gross_profit / gross_loss)
            if gross_loss
            else (None if not gross_profit else 99.99)
        ),
        "fillRate": _round(
            (filled_count / len(fill_candidates) * 100) if fill_candidates else None
        ),
        "averageSlippageBps": _round(fmean(slippage) if slippage else None),
        "averageSpreadBps": _round(fmean(spread) if spread else None),
        "filledOrderCount": filled_count,
        "closedTradeCount": len(sell_results),
        "dailySeries": series,
    }

