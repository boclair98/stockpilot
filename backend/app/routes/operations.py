"""Institutional operations console API.

Every endpoint is protected by a server-side Google email allow-list. The
console manages only StockPilot's simulation ledger; it cannot enable real
broker or exchange routing.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import Identity, require_operator
from app.models import (
    AuditEvent,
    Position,
    ReconciliationRun,
    TradeOrder,
    TradingAccount,
)
from app.services.audit import record_audit
from app.services.kis_market import kis_market
from app.services.reconciliation import run_reconciliation
from app.services.risk_engine import load_control

router = APIRouter(prefix="/api/operations", tags=["institutional-operations"])
CONTROL_ENTITY_ID = uuid5(NAMESPACE_URL, "stockpilot:trading-control:global")


def control_payload(control) -> dict:
    return {
        "scope": control.scope,
        "halted": control.halted,
        "haltReason": control.halt_reason,
        "maxOrderNotionalKrw": float(control.max_order_notional_krw),
        "maxOrderNotionalUsd": float(control.max_order_notional_usd),
        "maxOpenOrders": control.max_open_orders,
        "maxDailyOrders": control.max_daily_orders,
        "updatedAt": control.updated_at.isoformat() if control.updated_at else None,
    }


def reconciliation_payload(run: ReconciliationRun | None) -> dict | None:
    if not run:
        return None
    return {
        "id": str(run.id),
        "status": run.status,
        "accountCount": run.account_count,
        "orderCount": run.order_count,
        "positionCount": run.position_count,
        "discrepancyCount": run.discrepancy_count,
        "cashKrwTotal": float(run.cash_krw_total),
        "cashUsdTotal": float(run.cash_usd_total),
        "details": run.details,
        "createdAt": run.created_at.isoformat(),
    }


@router.get("/overview")
async def overview(
    operator: Identity = Depends(require_operator),
    session: AsyncSession = Depends(get_session),
) -> dict:
    control = await load_control(session)
    account_count, position_count, open_orders = (
        await session.execute(
            sa.select(
                sa.select(sa.func.count(TradingAccount.owner_id)).scalar_subquery(),
                sa.select(sa.func.count(Position.id)).scalar_subquery(),
                sa.select(sa.func.count(TradeOrder.id))
                .where(TradeOrder.status.in_(("OPEN", "TRIGGERED")))
                .scalar_subquery(),
            )
        )
    ).one()
    latest_run = (
        await session.execute(
            sa.select(ReconciliationRun)
            .order_by(ReconciliationRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return {
        "operator": {"email": operator.email, "name": operator.display_name},
        "mode": settings.trading_mode.upper(),
        "realOrderRouting": False,
        "control": control_payload(control),
        "marketData": kis_market.status(),
        "ledger": {
            "accountCount": int(account_count or 0),
            "positionCount": int(position_count or 0),
            "openOrderCount": int(open_orders or 0),
        },
        "latestReconciliation": reconciliation_payload(latest_run),
    }


class ControlUpdate(BaseModel):
    halted: bool
    haltReason: str | None = Field(default=None, max_length=200)
    maxOrderNotionalKrw: Decimal = Field(gt=0, le=10_000_000_000)
    maxOrderNotionalUsd: Decimal = Field(gt=0, le=10_000_000)
    maxOpenOrders: int = Field(ge=1, le=1000)
    maxDailyOrders: int = Field(ge=1, le=10000)

    @model_validator(mode="after")
    def reason_required_for_halt(self):
        if self.halted and not (self.haltReason or "").strip():
            raise ValueError("거래 중지 사유를 입력하세요.")
        return self


@router.put("/control")
async def update_control(
    payload: ControlUpdate,
    request: Request,
    operator: Identity = Depends(require_operator),
    session: AsyncSession = Depends(get_session),
) -> dict:
    control = await load_control(session, lock=True)
    before = control_payload(control)
    control.halted = payload.halted
    control.halt_reason = (payload.haltReason or "").strip() or None
    control.max_order_notional_krw = payload.maxOrderNotionalKrw
    control.max_order_notional_usd = payload.maxOrderNotionalUsd
    control.max_open_orders = payload.maxOpenOrders
    control.max_daily_orders = payload.maxDailyOrders
    control.updated_by = operator.id
    await session.flush()
    record_audit(
        session,
        actor_id=operator.id,
        event_type="TRADING_CONTROL_UPDATED",
        entity_type="trading_control",
        entity_id=CONTROL_ENTITY_ID,
        request_id=request.state.request_id,
        details={"before": before, "after": control_payload(control)},
    )
    return control_payload(control)


@router.post("/reconciliations", status_code=201)
async def reconcile(
    request: Request,
    operator: Identity = Depends(require_operator),
    session: AsyncSession = Depends(get_session),
) -> dict:
    run = await run_reconciliation(session, initiated_by=operator.id)
    record_audit(
        session,
        actor_id=operator.id,
        event_type="RECONCILIATION_COMPLETED",
        entity_type="reconciliation_run",
        entity_id=run.id,
        request_id=request.state.request_id,
        details={"status": run.status, "discrepancyCount": run.discrepancy_count},
    )
    return reconciliation_payload(run) or {}


@router.get("/audit-events")
async def audit_events(
    limit: int = Query(default=50, ge=1, le=200),
    _: Identity = Depends(require_operator),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (
        await session.execute(
            sa.select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)
        )
    ).scalars()
    return [
        {
            "id": str(row.id),
            "eventType": row.event_type,
            "entityType": row.entity_type,
            "entityId": str(row.entity_id),
            "requestId": row.request_id,
            "details": row.details,
            "createdAt": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/mode")
async def trading_mode() -> dict:
    """Public, non-sensitive product boundary for due-diligence automation."""

    mode = settings.trading_mode.upper()
    if mode != "SIMULATION":
        raise HTTPException(503, "승인되지 않은 거래 모드")
    return {"mode": mode, "realOrderRouting": False, "customerAssetsHeld": False}
