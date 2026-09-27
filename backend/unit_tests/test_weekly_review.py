from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app.models import PortfolioDailySnapshot, TradeOrder
from app.routes.growth import _loss_rebuys, _weekly_return


def test_weekly_return_requires_two_snapshots():
    first = PortfolioDailySnapshot(snapshot_date=date(2026, 9, 20), return_rate=Decimal("10"))
    second = PortfolioDailySnapshot(snapshot_date=date(2026, 9, 27), return_rate=Decimal("21"))
    assert _weekly_return([first]) is None
    assert _weekly_return([first, second]) == 10.0


def test_loss_rebuy_is_same_symbol_and_exchange_only():
    start = datetime(2026, 9, 20, tzinfo=UTC)
    loss = TradeOrder(symbol="005930", exchange="KRX", side="SELL", realized_pnl=Decimal("-1000"), created_at=start)
    unrelated_buy = TradeOrder(symbol="005930", exchange="NXT", side="BUY", created_at=start + timedelta(hours=1))
    rebuy = TradeOrder(symbol="005930", exchange="KRX", side="BUY", created_at=start + timedelta(hours=2))
    rows = _loss_rebuys([loss, unrelated_buy, rebuy])
    assert len(rows) == 1
    assert rows[0]["reboughtAt"] == rebuy.created_at.isoformat()
