"""KOSPI benchmark math for the virtual-investing experience.

The benchmark is deliberately kept separate from SQLAlchemy and HTTP code.  It
can therefore be reused by the public market endpoint, portfolio comparison,
daily jobs, and deterministic unit tests without making a second live-market
request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from statistics import pstdev
from typing import Iterable


@dataclass(frozen=True)
class BenchmarkPoint:
    day: date
    close: float


REGIME_LABELS = {
    "BULL": "상승장",
    "RANGE": "박스권",
    "BEAR": "하락장",
    "VOLATILE": "변동성 확대",
}


def _as_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    text = str(value or "")
    if len(text) == 8 and text.isdigit():
        text = f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def normalize_points(rows: Iterable[dict]) -> list[BenchmarkPoint]:
    points: list[BenchmarkPoint] = []
    for row in rows:
        day = _as_date(row.get("date"))
        try:
            close = float(row.get("close") or 0)
        except (TypeError, ValueError):
            close = 0
        if day and close > 0:
            points.append(BenchmarkPoint(day, close))
    return sorted(points, key=lambda point: point.day)


def _return_rate(start: float, end: float) -> float | None:
    if start <= 0:
        return None
    return (end / start - 1) * 100


def _window_return(points: list[BenchmarkPoint], length: int) -> float | None:
    if len(points) < 2:
        return None
    window = points[-min(length, len(points)) :]
    return _return_rate(window[0].close, window[-1].close)


def classify_regime(points: list[BenchmarkPoint]) -> tuple[str, float | None]:
    """Classify the latest KOSPI window using return and daily volatility.

    This is an educational signal, not investment advice.  Volatility wins
    over direction so learners do not mistake a sharp whipsaw for a trend.
    """

    if len(points) < 2:
        return "RANGE", None
    window = points[-min(20, len(points)) :]
    daily_returns = [
        (right.close / left.close - 1) * 100
        for left, right in zip(window, window[1:])
        if left.close > 0
    ]
    volatility = pstdev(daily_returns) if len(daily_returns) >= 2 else 0.0
    trend = _return_rate(window[0].close, window[-1].close)
    if volatility >= 2.5:
        return "VOLATILE", volatility
    if trend is not None and trend >= 3:
        return "BULL", volatility
    if trend is not None and trend <= -3:
        return "BEAR", volatility
    return "RANGE", volatility


def build_benchmark_report(rows: Iterable[dict]) -> dict:
    points = normalize_points(rows)
    regime, volatility = classify_regime(points)
    latest = points[-1] if points else None
    previous = points[-2] if len(points) >= 2 else None
    today_change = (
        _return_rate(previous.close, latest.close)
        if latest and previous
        else None
    )
    series = []
    for point in points[-30:]:
        base = points[0].close if points else point.close
        series.append(
            {
                "date": point.day.isoformat(),
                "value": round(point.close, 4),
                "returnRate": round((_return_rate(base, point.close) or 0), 4),
            }
        )
    return {
        "name": "KOSPI",
        "label": "코스피 종합",
        "current": round(latest.close, 4) if latest else None,
        "changePercent": round(today_change, 4) if today_change is not None else None,
        "return5d": round(_window_return(points, 5), 4)
        if _window_return(points, 5) is not None
        else None,
        "return20d": round(_window_return(points, 20), 4)
        if _window_return(points, 20) is not None
        else None,
        "volatility": round(volatility, 4) if volatility is not None else None,
        "regime": regime,
        "regimeLabel": REGIME_LABELS[regime],
        "asOf": latest.day.isoformat() if latest else None,
        "series": series,
        "dataQuality": "TRACKING" if len(points) >= 2 else "WAITING",
    }

