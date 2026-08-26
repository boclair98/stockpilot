from app.services.benchmark import (
    build_benchmark_report,
    classify_regime,
    normalize_points,
)


def _rows(closes: list[float]) -> list[dict]:
    return [
        {"date": f"2026-08-{index + 1:02d}", "close": close}
        for index, close in enumerate(closes)
    ]


def test_benchmark_report_calculates_return_windows_and_series() -> None:
    report = build_benchmark_report(_rows([100, 101, 102, 103, 104, 105]))

    assert report["current"] == 105
    assert report["return5d"] == 3.9604
    assert report["changePercent"] == 0.9615
    assert report["series"][-1]["returnRate"] == 5.0
    assert report["dataQuality"] == "TRACKING"


def test_regime_prioritizes_large_volatility() -> None:
    points = normalize_points(_rows([100, 106, 99, 105, 98, 104, 97, 103]))

    regime, volatility = classify_regime(points)

    assert regime == "VOLATILE"
    assert volatility is not None and volatility > 2.5


def test_short_history_waits_without_crashing() -> None:
    report = build_benchmark_report(_rows([100]))

    assert report["current"] == 100
    assert report["return20d"] is None
    assert report["regime"] == "RANGE"

