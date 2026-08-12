"""Ledger consistency checks used by the institutional operations console."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Position, ReconciliationRun, TradeOrder, TradingAccount


async def run_reconciliation(
    session: AsyncSession, *, initiated_by: UUID
) -> ReconciliationRun:
    account_count, cash_krw, cash_usd, negative_cash = (
        await session.execute(
            sa.select(
                sa.func.count(TradingAccount.owner_id),
                sa.func.coalesce(sa.func.sum(TradingAccount.cash_krw), 0),
                sa.func.coalesce(sa.func.sum(TradingAccount.cash), 0),
                sa.func.count(TradingAccount.owner_id).filter(
                    sa.or_(TradingAccount.cash_krw < 0, TradingAccount.cash < 0)
                ),
            )
        )
    ).one()
    position_count, negative_positions = (
        await session.execute(
            sa.select(
                sa.func.count(Position.id),
                sa.func.count(Position.id).filter(Position.quantity < 0),
            )
        )
    ).one()
    order_count, broken_fills = (
        await session.execute(
            sa.select(
                sa.func.count(TradeOrder.id),
                sa.func.count(TradeOrder.id).filter(
                    sa.and_(
                        TradeOrder.status == "FILLED",
                        sa.or_(
                            TradeOrder.fill_price.is_(None), TradeOrder.fill_price <= 0
                        ),
                    )
                ),
            )
        )
    ).one()
    discrepancy_count = (
        int(negative_cash or 0) + int(negative_positions or 0) + int(broken_fills or 0)
    )
    run = ReconciliationRun(
        status="PASSED" if discrepancy_count == 0 else "FAILED",
        account_count=int(account_count or 0),
        order_count=int(order_count or 0),
        position_count=int(position_count or 0),
        discrepancy_count=discrepancy_count,
        cash_krw_total=Decimal(cash_krw or 0),
        cash_usd_total=Decimal(cash_usd or 0),
        details={
            "negativeCashAccounts": int(negative_cash or 0),
            "negativePositions": int(negative_positions or 0),
            "filledOrdersWithoutPrice": int(broken_fills or 0),
        },
        initiated_by=initiated_by,
    )
    session.add(run)
    await session.flush()
    return run
