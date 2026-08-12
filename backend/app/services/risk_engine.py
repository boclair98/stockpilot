"""Pre-trade institutional controls for the simulation ledger.

This module deliberately contains no broker/exchange order adapter. A mode
other than SIMULATION fails closed until an approved institutional integration
is implemented and independently certified.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import TradeOrder, TradingControl


@dataclass(frozen=True)
class RiskDecision:
    allowed: bool
    code: str
    message: str
    notional: Decimal


def quote_age_seconds(quote: dict, now: datetime | None = None) -> float | None:
    try:
        as_of = datetime.fromisoformat(str(quote["asOf"]).replace("Z", "+00:00"))
        if as_of.tzinfo is None:
            as_of = as_of.replace(tzinfo=UTC)
        return max(0.0, ((now or datetime.now(UTC)) - as_of).total_seconds())
    except (KeyError, TypeError, ValueError):
        return None


async def load_control(session: AsyncSession, *, lock: bool = False) -> TradingControl:
    query = sa.select(TradingControl).where(TradingControl.scope == "GLOBAL")
    if lock:
        query = query.with_for_update()
    control = (await session.execute(query)).scalar_one_or_none()
    if control:
        return control
    await session.execute(
        insert(TradingControl)
        .values(
            scope="GLOBAL",
            max_order_notional_krw=settings.risk_max_order_notional_krw,
            max_order_notional_usd=settings.risk_max_order_notional_usd,
            max_open_orders=settings.risk_max_open_orders,
            max_daily_orders=settings.risk_max_daily_orders,
        )
        .on_conflict_do_nothing(index_elements=[TradingControl.scope])
    )
    control = (await session.execute(query)).scalar_one()
    return control


async def assess_pretrade(
    session: AsyncSession,
    *,
    owner: UUID,
    side: str,
    order_type: str,
    quantity: Decimal,
    currency: str,
    quote: dict,
    limit_price: Decimal | None,
    trigger_price: Decimal | None,
) -> RiskDecision:
    price = Decimal(str(quote.get("price") or "0"))
    notional = price * quantity
    if settings.trading_mode.upper() != "SIMULATION":
        return RiskDecision(
            False,
            "UNAPPROVED_TRADING_MODE",
            "승인되지 않은 거래 모드입니다. 모든 주문이 안전하게 중지되었습니다.",
            notional,
        )
    # A read lock would serialize every user's order on the GLOBAL row.
    # Operations updates are atomic, so pre-trade checks can read the current
    # committed limits without turning the control record into a bottleneck.
    control = await load_control(session)
    if control.halted:
        return RiskDecision(
            False,
            "GLOBAL_HALT",
            control.halt_reason or "기관 운영자가 신규 주문을 일시 중지했습니다.",
            notional,
        )
    age = quote_age_seconds(quote)
    if age is None or age > settings.market_data_max_age_seconds:
        return RiskDecision(
            False,
            "STALE_MARKET_DATA",
            "시세가 지연되어 주문을 보호 차단했습니다. 최신 시세 수신 후 다시 시도하세요.",
            notional,
        )
    max_notional = Decimal(
        control.max_order_notional_krw
        if currency == "KRW"
        else control.max_order_notional_usd
    )
    if notional > max_notional:
        return RiskDecision(
            False,
            "MAX_ORDER_NOTIONAL",
            f"주문 금액이 기관 위험한도 {max_notional:,.2f} {currency}를 초과했습니다.",
            notional,
        )
    open_orders = await session.scalar(
        sa.select(sa.func.count(TradeOrder.id)).where(
            TradeOrder.owner_id == owner,
            TradeOrder.status.in_(("OPEN", "TRIGGERED")),
        )
    )
    if int(open_orders or 0) >= control.max_open_orders:
        return RiskDecision(
            False,
            "MAX_OPEN_ORDERS",
            "대기 주문 한도에 도달했습니다. 기존 주문을 취소한 후 다시 시도하세요.",
            notional,
        )
    today = datetime.now(UTC).date()
    daily_orders = await session.scalar(
        sa.select(sa.func.count(TradeOrder.id)).where(
            TradeOrder.owner_id == owner,
            sa.func.date(TradeOrder.created_at) == today,
        )
    )
    if int(daily_orders or 0) >= control.max_daily_orders:
        return RiskDecision(
            False,
            "MAX_DAILY_ORDERS",
            "일일 주문 횟수 한도에 도달했습니다.",
            notional,
        )
    reference_prices = [
        candidate for candidate in (limit_price, trigger_price) if candidate is not None
    ]
    max_deviation = settings.risk_max_price_deviation_percent / Decimal("100")
    if price > 0 and any(
        abs(candidate - price) / price > max_deviation for candidate in reference_prices
    ):
        return RiskDecision(
            False,
            "PRICE_COLLAR",
            "지정·감시 가격이 현재가 허용 범위를 벗어났습니다.",
            notional,
        )
    return RiskDecision(True, "APPROVED", "사전 위험검사를 통과했습니다.", notional)
