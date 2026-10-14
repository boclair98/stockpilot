"""Bounded scheduler: one weekly slot, no catch-up or real broker orders."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import sqlalchemy as sa

from app.core.database import AsyncSessionLocal
from app.core.traffic import traffic_store
from app.models import TradeOrder, User
from app.personal_models import CorporateAction, MoneyEvent, RecurringPlan, RecurringRun
from app.routes.trading import account, execute, simulation_charges
from app.services.audit import record_audit
from app.services.execution_quality import simulated_fill
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market
from app.services.personal_ledger import apply_action, require_simulation
from app.services.personal_math import aware, next_weekly
from app.services.risk_engine import assess_pretrade, quote_age_seconds

logger = logging.getLogger(__name__)


def live_regular(quote, market, now):
    local = aware(now).astimezone(
        ZoneInfo("Asia/Seoul" if market == "KR" else "America/New_York")
    )
    clock = local.strftime("%H:%M")
    regular = (
        "09:00" <= clock <= "15:20" if market == "KR" else "09:30" <= clock <= "15:59"
    )
    age = quote_age_seconds(quote or {}, now)
    return (
        local.weekday() < 5
        and regular
        and quote
        and quote.get("marketState") == "LIVE"
        and age is not None
        and age <= 30
        and Decimal(str(quote.get("price") or 0)) > 0
    )


async def run_plan(session, plan_id, item, quote, now):
    candidate = await session.get(RecurringPlan, plan_id)
    if candidate is None:
        return None
    await account(session, candidate.owner_id, lock=True)
    plan = await session.scalar(
        sa.select(RecurringPlan).where(RecurringPlan.id == plan_id).with_for_update()
    )
    if not plan or not plan.active or aware(plan.next_at) > now:
        return None
    due = aware(plan.next_at)
    previous = await session.scalar(
        sa.select(RecurringRun).where(
            RecurringRun.plan_id == plan.id, RecurringRun.due_at == due
        )
    )
    if previous:
        plan.next_at = next_weekly(now, plan.weekday, plan.local_time, plan.timezone)
        return previous
    run = RecurringRun(
        plan_id=plan.id,
        owner_id=plan.owner_id,
        due_at=due,
        status="SKIPPED",
        reason="최신 실시간 시세를 확인하지 못해 이번 회차를 건너뛰었어요.",
    )
    session.add(run)
    plan.next_at = next_weekly(now, plan.weekday, plan.local_time, plan.timezone)
    if now - due > timedelta(minutes=30):
        run.reason = "실행 시간이 지났어요. 지난 회차를 소급 매수하지 않아요."
    elif item and live_regular(quote, item.market, now):
        try:
            await require_simulation(session)
            wallet = await account(session, plan.owner_id, lock=True)
            price = Decimal(str(quote["price"]))
            quantity = min(
                Decimal(10000),
                (Decimal(plan.amount) / (price * Decimal("1.02"))).to_integral_value(
                    rounding=ROUND_DOWN
                ),
            )
            if quantity <= 0:
                run.reason = "이번 예산으로는 1주를 살 수 없어요."
            else:
                quality = simulated_fill(
                    reference_price=price,
                    side="BUY",
                    quantity=quantity,
                    currency=item.currency,
                    quote=quote,
                    limit_price=None,
                )
                fee, _ = simulation_charges(
                    quantity * quality.price, item.currency, "BUY"
                )
                total = quantity * quality.price + fee
                cash = Decimal(
                    wallet.cash_krw if item.currency == "KRW" else wallet.cash
                )
                risk = await assess_pretrade(
                    session,
                    owner=plan.owner_id,
                    side="BUY",
                    order_type="MARKET",
                    quantity=quantity,
                    currency=item.currency,
                    quote=quote,
                    limit_price=None,
                    trigger_price=None,
                )
                pending = await session.scalar(
                    sa.select(TradeOrder.id)
                    .where(
                        TradeOrder.owner_id == plan.owner_id,
                        TradeOrder.side == "BUY",
                        TradeOrder.status.in_(["OPEN", "TRIGGERED"]),
                    )
                    .limit(1)
                )
                if pending:
                    run.reason = "대기 매수 주문이 있어 예산을 보호했어요."
                elif not risk.allowed:
                    run.reason = risk.message[:240]
                elif total > Decimal(plan.amount) or total > cash:
                    run.reason = "예산이나 가상 현금이 부족해요."
                else:
                    order = TradeOrder(
                        owner_id=plan.owner_id,
                        symbol=item.symbol,
                        exchange=item.exchange,
                        side="BUY",
                        order_type="MARKET",
                        quantity=quantity,
                        status="OPEN",
                        idempotency_key=f"recurring:{plan.id}:{due.date()}",
                    )
                    session.add(order)
                    await session.flush()
                    await execute(session, order, item, price, quote)
                    run.order_id = order.id
                    run.status = "FILLED" if order.status == "FILLED" else "FAILED"
                    run.reason = (
                        f"{item.name} {quantity.normalize()}주 모의 매수 체결"
                        if order.status == "FILLED"
                        else order.reject_reason or "모의 주문을 체결하지 못했어요."
                    )
                    record_audit(
                        session,
                        actor_id=plan.owner_id,
                        event_type=f"RECURRING_{run.status}",
                        entity_id=order.id,
                        request_id=order.idempotency_key,
                        details={"planId": str(plan.id), "dueAt": due.isoformat()},
                    )
        except Exception as exc:
            if getattr(exc, "status_code", None) != 409:
                raise
            run.reason = str(exc.detail)[:240]
    await session.flush()
    return run


class PersonalWorker:
    def __init__(self):
        self.task = None

    def start(self):
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.loop(), name="personal-tools-worker")

    async def stop(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        self.task = None

    async def loop(self):
        while True:
            lease = None
            try:
                lease = await traffic_store.acquire_lock(
                    "background:personal-tools", ttl_seconds=120
                )
                if lease:
                    await asyncio.wait_for(self.poll(), timeout=90)
                    await traffic_store.set_json(
                        "personal:worker:heartbeat",
                        {"at": datetime.now(UTC).isoformat(), "status": "ok"},
                        ttl=180,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "Personal worker stopped this batch: %s", type(exc).__name__
                )
            finally:
                if lease:
                    await traffic_store.release_lock("background:personal-tools", lease)
            await asyncio.sleep(15)

    async def poll(self):
        now = datetime.now(UTC)
        async with AsyncSessionLocal() as session:
            plans = list(
                (
                    await session.scalars(
                        sa.select(RecurringPlan)
                        .where(
                            RecurringPlan.active.is_(True),
                            RecurringPlan.next_at <= now + timedelta(minutes=30),
                        )
                        .order_by(RecurringPlan.next_at)
                        .limit(50)
                    )
                ).all()
            )
        for plan in plans:
            item = await instrument_catalog.get(plan.symbol, plan.market, plan.exchange)
            if item:
                await kis_market.watch(item)
            if aware(plan.next_at) > now:
                continue
            quote = kis_market.quote(plan.symbol, plan.market, plan.exchange)
            async with AsyncSessionLocal.begin() as session:
                await run_plan(session, plan.id, item, quote, now)
        cursor = await traffic_store.get_json("personal:corporate:cursor")
        try:
            after_id = UUID(cursor["after"]) if cursor else None
        except (ValueError, KeyError, TypeError):
            after_id = None
        async with AsyncSessionLocal() as session:
            actions = list(
                (
                    await session.scalars(
                        sa.select(CorporateAction)
                        .where(
                            CorporateAction.status == "VERIFIED",
                            CorporateAction.pay_at <= now,
                            *([CorporateAction.id > after_id] if after_id else []),
                        )
                        .order_by(CorporateAction.id)
                        .limit(50)
                    )
                ).all()
            )
        remaining = 100
        for action in actions:
            async with AsyncSessionLocal() as session:
                existing = sa.select(MoneyEvent.owner_id).where(
                    MoneyEvent.kind == action.kind,
                    MoneyEvent.request_key == str(action.id),
                    sa.or_(
                        MoneyEvent.status.in_(["APPLIED", "NO_ENTITLEMENT"]),
                        MoneyEvent.updated_at > now - timedelta(minutes=5),
                    ),
                )
                owners = list(
                    (
                        await session.scalars(
                            sa.select(TradeOrder.owner_id)
                            .join(User, User.coders_id == TradeOrder.owner_id)
                            .where(
                                TradeOrder.symbol == action.symbol,
                                TradeOrder.exchange == action.exchange,
                                TradeOrder.status == "FILLED",
                                TradeOrder.owner_id.notin_(existing),
                            )
                            .distinct()
                            .limit(remaining)
                        )
                    ).all()
                )
            for owner in owners:
                async with AsyncSessionLocal.begin() as session:
                    await apply_action(session, owner, action)
                remaining -= 1
            if remaining <= 0:
                await traffic_store.set_json(
                    "personal:corporate:cursor", {"after": str(action.id)}, ttl=86400
                )
                break
        else:
            await traffic_store.set_json(
                "personal:corporate:cursor",
                {"after": str(actions[-1].id)} if actions else {},
                ttl=86400,
            )


personal_worker = PersonalWorker()
