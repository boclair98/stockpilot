from decimal import Decimal

from app.routes.engagement import (
    alert_triggered,
    combined_return_rate,
    mission_rows,
)
from app.routes.trading import order_state, simulation_charges


def test_price_alert_direction() -> None:
    assert alert_triggered("ABOVE", Decimal("101"), Decimal("100"))
    assert alert_triggered("BELOW", Decimal("99"), Decimal("100"))
    assert not alert_triggered("ABOVE", Decimal("99"), Decimal("100"))


def test_combined_return_removes_fx_weight() -> None:
    result = combined_return_rate(Decimal("110000000"), Decimal("90000"))
    assert result == Decimal("0")


def test_missions_report_progress() -> None:
    rows = mission_rows(1, 0, 2, 3, 1, False)
    progress = {row["key"]: row["progress"] for row in rows}
    assert progress["first-trade"] == 1
    assert progress["watchlist"] == 3
    assert progress["diversified"] == 2


def test_advanced_order_states() -> None:
    assert order_state(
        "STOP",
        "OPEN",
        "SELL",
        Decimal("89"),
        None,
        Decimal("90"),
    ) == ("TRIGGERED", True)
    assert order_state(
        "STOP_LIMIT",
        "OPEN",
        "BUY",
        Decimal("101"),
        Decimal("102"),
        Decimal("100"),
    ) == ("TRIGGERED", True)
    assert order_state(
        "STOP",
        "OPEN",
        "SELL",
        Decimal("91"),
        None,
        Decimal("90"),
    ) == ("OPEN", False)


def test_simulation_charges_include_kr_sell_tax() -> None:
    fee, tax = simulation_charges(Decimal("1000000"), "KRW", "SELL")
    assert fee == Decimal("150")
    assert tax == Decimal("2000")
