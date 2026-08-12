from decimal import Decimal

from app.services.execution_quality import protection_trigger, simulated_fill


def test_market_buy_includes_spread_and_volume_impact() -> None:
    fill = simulated_fill(
        reference_price=Decimal("100"),
        side="BUY",
        quantity=Decimal("100"),
        currency="USD",
        quote={"high": 102, "low": 98, "volume": 100_000},
    )

    assert fill.price > Decimal("100")
    assert fill.spread_bps > 0
    assert fill.slippage_bps > fill.spread_bps / 2
    assert fill.participation_rate == Decimal("0.00100000")


def test_limit_order_never_fills_worse_than_limit() -> None:
    buy = simulated_fill(
        reference_price=Decimal("100"),
        side="BUY",
        quantity=Decimal("5000"),
        currency="USD",
        quote={"high": 105, "low": 95, "volume": 5000},
        limit_price=Decimal("100.10"),
    )
    sell = simulated_fill(
        reference_price=Decimal("100"),
        side="SELL",
        quantity=Decimal("5000"),
        currency="USD",
        quote={"high": 105, "low": 95, "volume": 5000},
        limit_price=Decimal("99.90"),
    )

    assert buy.price <= Decimal("100.10")
    assert sell.price >= Decimal("99.90")


def test_protection_is_oco() -> None:
    assert protection_trigger(Decimal("111"), Decimal("110"), Decimal("90")) == "TAKE_PROFIT"
    assert protection_trigger(Decimal("89"), Decimal("110"), Decimal("90")) == "STOP_LOSS"
    assert protection_trigger(Decimal("100"), Decimal("110"), Decimal("90")) is None

