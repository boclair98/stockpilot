from datetime import date
from decimal import Decimal

from app.services.portfolio_analytics import (
    ExecutionPoint,
    SnapshotPoint,
    build_portfolio_analytics,
)


def test_analytics_calculates_drawdown_risk_and_execution_quality():
    snapshots = [
        SnapshotPoint(date(2026, 1, 1), Decimal("0")),
        SnapshotPoint(date(2026, 1, 2), Decimal("2")),
        SnapshotPoint(date(2026, 1, 3), Decimal("1")),
        SnapshotPoint(date(2026, 1, 4), Decimal("3")),
    ]
    executions = [
        ExecutionPoint("BUY", "FILLED", slippage_bps=Decimal("1.2"), spread_bps=Decimal("2")),
        ExecutionPoint("SELL", "FILLED", realized_pnl=Decimal("120"), slippage_bps=Decimal("1.8"), spread_bps=Decimal("3")),
        ExecutionPoint("SELL", "FILLED", realized_pnl=Decimal("-40"), slippage_bps=Decimal("2.0"), spread_bps=Decimal("4")),
        ExecutionPoint("BUY", "REJECTED"),
    ]

    result = build_portfolio_analytics(snapshots, executions, open_position_count=2)

    assert result["dataQuality"] == "TRACKING"
    assert result["totalReturn"] == 3.0
    assert result["maxDrawdown"] == 1.0
    assert result["winRate"] == 50.0
    assert result["profitFactor"] == 3.0
    assert result["fillRate"] == 75.0
    assert result["averageSlippageBps"] == 1.67
    assert result["openPositionCount"] == 2
    assert result["dailySeries"][-1]["change"] == 2.0


def test_analytics_fails_open_with_starting_state():
    result = build_portfolio_analytics(
        [SnapshotPoint(date(2026, 1, 1), Decimal("0"))],
        [],
    )

    assert result["dataQuality"] == "STARTING"
    assert result["maxDrawdown"] == 0.0
    assert result["sharpeRatio"] is None
    assert result["winRate"] is None
    assert result["dailySeries"][0]["change"] is None

