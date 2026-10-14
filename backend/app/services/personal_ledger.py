"""Decimal paper-ledger operations shared by API and singleton worker."""

from datetime import UTC, datetime
from decimal import ROUND_DOWN, Decimal
from uuid import UUID

import sqlalchemy as sa
from fastapi import HTTPException

from app.core.config import settings
from app.models import Position, PracticeRound, ProtectionPlan, TradeOrder
from app.personal_models import CorporateAction, MoneyEvent
from app.services.audit import record_audit
from app.services.personal_math import aware, split_values
from app.services.risk_engine import load_control


async def require_simulation(session):
    if (
        settings.trading_mode.upper() != "SIMULATION"
        or (await load_control(session)).halted
    ):
        raise HTTPException(
            409, "계좌 변경을 일시 중지했어요. 잠시 후 다시 확인해 주세요."
        )


async def fx_flows(session, owners):
    """Cash transfers are not investment profit. Aggregate, never blend currencies."""
    result = {owner: {"KRW": Decimal(0), "USD": Decimal(0)} for owner in owners}
    if not owners:
        return result
    rows = await session.execute(
        sa.select(
            MoneyEvent.owner_id,
            sa.func.sum(
                sa.cast(MoneyEvent.data["flowKrw"].as_string(), sa.Numeric(24, 4))
            ),
            sa.func.sum(
                sa.cast(MoneyEvent.data["flowUsd"].as_string(), sa.Numeric(24, 4))
            ),
        )
        .where(
            MoneyEvent.owner_id.in_(owners),
            MoneyEvent.kind == "FX",
            MoneyEvent.status == "BOOKED",
        )
        .group_by(MoneyEvent.owner_id)
    )
    for owner, krw, usd in rows:
        result[owner]["KRW"], result[owner]["USD"] = (
            Decimal(krw or 0),
            Decimal(usd or 0),
        )
    return result


async def performance_equity(session, owner, krw, usd):
    flows = (await fx_flows(session, [owner]))[owner]
    return Decimal(krw) - flows["KRW"], Decimal(usd) - flows["USD"]


async def book_fx(session, owner, quote_id):
    from app.routes.trading import account

    await require_simulation(session)
    wallet = await account(session, owner, lock=True)
    row = await session.scalar(
        sa.select(MoneyEvent)
        .where(
            MoneyEvent.id == quote_id,
            MoneyEvent.owner_id == owner,
            MoneyEvent.kind == "FX",
        )
        .with_for_update()
    )
    if row is None:
        raise HTTPException(404, "환전 견적이 없어요.")
    if row.status == "BOOKED":
        return row
    if (
        row.status != "QUOTED"
        or row.expires_at is None
        or aware(row.expires_at) <= datetime.now(UTC)
    ):
        raise HTTPException(409, "견적이 만료됐어요. 다시 계산해 주세요.")
    # A pending buy has not debited cash. Fail closed instead of spending its funds.
    pending = await session.scalar(
        sa.select(TradeOrder.id)
        .where(
            TradeOrder.owner_id == owner,
            TradeOrder.side == "BUY",
            TradeOrder.status.in_(["OPEN", "TRIGGERED"]),
        )
        .limit(1)
    )
    if pending:
        raise HTTPException(
            409, "대기 중인 매수 주문을 먼저 체결하거나 취소한 뒤 환전해 주세요."
        )
    amount, received = Decimal(row.data["amount"]), Decimal(row.data["received"])
    krw, usd = (
        (-amount, received)
        if row.data["direction"] == "KRW_TO_USD"
        else (received, -amount)
    )
    if Decimal(wallet.cash_krw) + krw < 0 or Decimal(wallet.cash) + usd < 0:
        raise HTTPException(409, "환전할 가상 현금이 부족해요.")
    wallet.cash_krw, wallet.cash = (
        Decimal(wallet.cash_krw) + krw,
        Decimal(wallet.cash) + usd,
    )
    row.status, row.updated_at = "BOOKED", datetime.now(UTC)
    row.data = {
        **row.data,
        "flowKrw": str(krw),
        "flowUsd": str(usd),
        "balanceKrw": str(wallet.cash_krw),
        "balanceUsd": str(wallet.cash),
        "message": "가상 환전을 완료했어요. 통화 이동은 투자 수익률에서 제외해요.",
    }
    record_audit(
        session,
        actor_id=owner,
        event_type="PAPER_FX_BOOKED",
        entity_id=row.id,
        request_id=str(row.id),
        entity_type="money_event",
        details={
            "direction": row.data["direction"],
            "amount": str(amount),
            "received": str(received),
            "rateDate": row.data["date"],
        },
    )
    await session.flush()
    return row


async def entitled_quantity(session, owner, action):
    filled_time = sa.func.coalesce(TradeOrder.processed_at, TradeOrder.created_at)
    quantity = await session.scalar(
        sa.select(
            sa.func.coalesce(
                sa.func.sum(
                    sa.case(
                        (TradeOrder.side == "BUY", TradeOrder.quantity),
                        else_=-TradeOrder.quantity,
                    )
                ),
                0,
            )
        ).where(
            TradeOrder.owner_id == owner,
            TradeOrder.symbol == action.symbol,
            TradeOrder.exchange == action.exchange,
            TradeOrder.status == "FILLED",
            filled_time < action.cutoff_at,
        )
    )
    splits = list(
        (
            await session.scalars(
                sa.select(MoneyEvent).where(
                    MoneyEvent.owner_id == owner,
                    MoneyEvent.kind == "SPLIT",
                    MoneyEvent.status == "APPLIED",
                )
            )
        ).all()
    )
    for split in splits:
        data = split.data
        if (
            data.get("symbol") == action.symbol
            and data.get("exchange") == action.exchange
            and aware(datetime.fromisoformat(data["effectiveAt"]))
            < aware(action.cutoff_at)
        ):
            quantity += Decimal(data["quantityDelta"])
    return max(Decimal(0), Decimal(quantity))


async def split_pending(session, owner, symbol, exchange):
    actions = list(
        (
            await session.scalars(
                sa.select(CorporateAction)
                .where(
                    CorporateAction.kind == "SPLIT",
                    CorporateAction.status == "VERIFIED",
                    CorporateAction.symbol == symbol,
                    CorporateAction.exchange == exchange,
                    CorporateAction.pay_at <= datetime.now(UTC),
                )
                .limit(50)
            )
        ).all()
    )
    if actions and await session.scalar(
        sa.select(PracticeRound.id)
        .where(PracticeRound.ledger_owner_id == owner)
        .limit(1)
    ):
        # Separate restart/practice ledgers are intentionally not corporate-action
        # participants; do not freeze them on an original-account pending action.
        return False
    for action in actions:
        event = await session.scalar(
            sa.select(MoneyEvent.status).where(
                MoneyEvent.owner_id == owner,
                MoneyEvent.kind == "SPLIT",
                MoneyEvent.request_key == str(action.id),
            )
        )
        if (
            event not in {"APPLIED", "NO_ENTITLEMENT"}
            and await entitled_quantity(session, owner, action) > 0
        ):
            return True
    return False


async def apply_action(session, owner: UUID, action):
    from app.routes.trading import account

    await require_simulation(session)
    wallet = await account(session, owner, lock=True)
    row = await session.scalar(
        sa.select(MoneyEvent)
        .where(
            MoneyEvent.owner_id == owner,
            MoneyEvent.kind == action.kind,
            MoneyEvent.request_key == str(action.id),
        )
        .with_for_update()
    )
    if row and row.status in {"APPLIED", "NO_ENTITLEMENT"}:
        return row
    if aware(action.pay_at) > datetime.now(UTC):
        raise ValueError("Not due")
    quantity = await entitled_quantity(session, owner, action)
    data = {
        "symbol": action.symbol,
        "exchange": action.exchange,
        "currency": action.currency,
        "sourceUrl": action.source_url,
        "effectiveAt": aware(action.cutoff_at).isoformat(),
        "eligibleQuantity": str(quantity),
    }
    if row is None:
        row = MoneyEvent(
            owner_id=owner,
            kind=action.kind,
            request_key=str(action.id),
            status="BLOCKED",
            data=data,
        )
        session.add(row)
    row.updated_at = datetime.now(UTC)
    if quantity <= 0:
        row.status, row.data = "NO_ENTITLEMENT", data
        await session.flush()
        return row
    if action.kind == "DIVIDEND":
        unit = Decimal("1") if action.currency == "KRW" else Decimal("0.01")
        gross = (quantity * Decimal(action.per_share)).quantize(
            unit, rounding=ROUND_DOWN
        )
        field = "cash_krw" if action.currency == "KRW" else "cash"
        setattr(wallet, field, Decimal(getattr(wallet, field)) + gross)
        row.status = "APPLIED"
        row.data = {
            **data,
            "amount": str(gross),
            "message": f"세전 모의 배당 {gross:,.2f} {action.currency} 반영",
        }
    else:
        pending = await session.scalar(
            sa.select(TradeOrder.id)
            .where(
                TradeOrder.owner_id == owner,
                TradeOrder.symbol == action.symbol,
                TradeOrder.exchange == action.exchange,
                TradeOrder.status.in_(["OPEN", "TRIGGERED"]),
            )
            .limit(1)
        )
        protection = await session.scalar(
            sa.select(ProtectionPlan.id)
            .where(
                ProtectionPlan.owner_id == owner,
                ProtectionPlan.symbol == action.symbol,
                ProtectionPlan.exchange == action.exchange,
                ProtectionPlan.status.in_(["ACTIVE", "TRIGGERED"]),
            )
            .limit(1)
        )
        after = await session.scalar(
            sa.select(TradeOrder.id)
            .where(
                TradeOrder.owner_id == owner,
                TradeOrder.symbol == action.symbol,
                TradeOrder.exchange == action.exchange,
                TradeOrder.status == "FILLED",
                sa.func.coalesce(TradeOrder.processed_at, TradeOrder.created_at)
                >= action.cutoff_at,
            )
            .limit(1)
        )
        try:
            # Pending activity fails closed before waiting on a position lock.
            if pending or protection or after:
                raise ValueError(
                    "대기 주문·보호 설정·권리 이후 매매를 확인해 주세요. 자동으로 수량을 바꾸지 않았어요."
                )
            position = await session.scalar(
                sa.select(Position)
                .where(
                    Position.owner_id == owner,
                    Position.symbol == action.symbol,
                    Position.exchange == action.exchange,
                )
                .with_for_update()
            )
            if not position or Decimal(position.quantity) != quantity:
                raise ValueError(
                    "대기 주문·보호 설정·권리 이후 매매를 확인해 주세요. 자동으로 수량을 바꾸지 않았어요."
                )
            new_quantity, average = split_values(
                position.quantity, position.average_price, action.ratio
            )
            row.data = {
                **data,
                "ratio": str(action.ratio),
                "quantityDelta": str(new_quantity - Decimal(position.quantity)),
                "message": f"분할 반영 · {quantity.normalize()}주 → {new_quantity.normalize()}주",
            }
            position.quantity, position.average_price, row.status = (
                new_quantity,
                average,
                "APPLIED",
            )
        except ValueError as exc:
            row.status, row.data = "BLOCKED", {**data, "message": str(exc)}
    await session.flush()
    record_audit(
        session,
        actor_id=owner,
        event_type=f"CORPORATE_{row.status}",
        entity_id=row.id,
        request_id=str(action.id),
        entity_type="money_event",
        details=row.data,
    )
    return row
