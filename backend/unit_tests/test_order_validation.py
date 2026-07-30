from decimal import Decimal

from app.routes.trading import quantity_text, sell_quantity_error


def test_sell_rejects_unowned_stock() -> None:
    available, error = sell_quantity_error(
        Decimal("0"), Decimal("0"), Decimal("1")
    )

    assert available == 0
    assert error == "보유하지 않은 종목은 매도할 수 없습니다."


def test_sell_reserves_quantity_for_pending_orders() -> None:
    available, error = sell_quantity_error(
        Decimal("10"), Decimal("7"), Decimal("4")
    )

    assert available == 3
    assert error is not None
    assert "대기 중인 매도 주문 7주" in error


def test_sell_accepts_available_quantity() -> None:
    available, error = sell_quantity_error(
        Decimal("10"), Decimal("3"), Decimal("7")
    )

    assert available == 7
    assert error is None


def test_quantity_text_does_not_use_scientific_notation() -> None:
    assert quantity_text(Decimal("1000.000000")) == "1000"
    assert quantity_text(Decimal("0.125000")) == "0.125"
