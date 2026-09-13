"""Payment-independent monetization foundation for StockPilot.

The catalog and entitlement contract are deliberately available before a
payment provider is connected. Checkout remains fail-closed until the
operator configures a provider and verifies signed webhooks. This prevents a
button in the browser from being treated as proof of payment.
"""

from __future__ import annotations

from typing import Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import current_identity, require_identity, require_operator
from app.models import BillingInterest

router = APIRouter(prefix="/api/billing", tags=["billing"])


PLANS: tuple[dict, ...] = (
    {
        "id": "FREE",
        "name": "시작하기",
        "eyebrow": "FREE",
        "priceKrw": 0,
        "period": "영구 무료",
        "description": "실제 시세로 가상투자를 배우는 데 필요한 핵심 기능",
        "features": (
            "KRX·NXT·미국 실시간 시세",
            "가상주문·보유잔고·수익률 리그",
            "기본 가격 알림 3개",
            "기초 학습·오늘의 차트",
        ),
        "limits": {"alerts": 3, "leagues": 1, "historyDays": 30},
        "status": "active",
    },
    {
        "id": "PRO",
        "name": "Pro",
        "eyebrow": "FOR SERIOUS PRACTICE",
        "priceKrw": 5900,
        "period": "월간 · 언제든 해지",
        "description": "투자 습관과 리스크를 깊게 복기하는 개인용 플랜",
        "features": (
            "가격·조건 알림 무제한",
            "시장 타임머신 전체 구간·복기",
            "샤프·낙폭·슬리피지 고급 리포트",
            "CSV/PDF 성과 내보내기",
            "광고 없는 집중 화면",
        ),
        "limits": {"alerts": None, "leagues": 5, "historyDays": 3650},
        "status": "prelaunch",
    },
    {
        "id": "TEAM",
        "name": "Team",
        "eyebrow": "FOR STUDY & EDUCATION",
        "priceKrw": 49000,
        "period": "월간 · 20석부터",
        "description": "스터디·학교·교육기관이 비공개 리그를 운영하는 플랜",
        "features": (
            "비공개 수익률 리그·초대 코드",
            "참가자별 성과·리스크 대시보드",
            "주간 리포트·CSV 내보내기",
            "관리자 권한·운영 로그",
            "좌석·사용량 기반 확장",
        ),
        "limits": {"alerts": None, "leagues": None, "historyDays": 3650},
        "status": "prelaunch",
    },
)

PLAN_IDS = Literal["PRO", "TEAM"]


class InterestIn(BaseModel):
    planId: PLAN_IDS


def _plan(plan_id: str) -> dict:
    return next(item for item in PLANS if item["id"] == plan_id)


@router.get("/plans")
async def plans() -> dict:
    """Return the public catalog used by the pricing page.

    Prices and feature limits are server-owned so a future checkout and
    entitlement service can share the same contract as the UI.
    """

    return {
        "version": 1,
        "currency": "KRW",
        "checkoutConfigured": bool(
            settings.payment_checkout_enabled
            and settings.payment_provider.lower() != "none"
        ),
        "provider": settings.payment_provider,
        "plans": PLANS,
    }


@router.get("/entitlement")
async def entitlement(request: Request) -> dict:
    """Return the server-side feature contract for the current visitor.

    Until verified payment webhooks are enabled, every visitor is explicitly
    on FREE. The client must not infer paid access from local storage or UI
    state.
    """

    identity = current_identity(request)
    free = _plan("FREE")
    return {
        "authenticated": bool(identity),
        "plan": "FREE",
        "status": "active",
        "billingStatus": "prelaunch",
        "features": list(free["features"]),
        "limits": free["limits"],
    }


@router.post("/interests", status_code=status.HTTP_201_CREATED)
async def register_interest(
    payload: InterestIn,
    owner_id=Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Register demand for a paid plan without collecting extra PII."""

    statement = pg_insert(BillingInterest).values(
        owner_id=owner_id,
        plan_id=payload.planId,
    )
    statement = statement.on_conflict_do_nothing(
        index_elements=["owner_id", "plan_id"]
    )
    await session.execute(statement)
    return {
        "ok": True,
        "planId": payload.planId,
        "status": "interest_recorded",
        "message": f"{_plan(payload.planId)['name']} 출시 알림을 신청했어요.",
    }


@router.get("/admin/interests")
async def interest_summary(
    _: object = Depends(require_operator),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return aggregate demand only; never expose individual accounts."""

    rows = await session.execute(
        sa.select(BillingInterest.plan_id, sa.func.count())
        .group_by(BillingInterest.plan_id)
        .order_by(BillingInterest.plan_id)
    )
    counts = {str(plan_id): int(count) for plan_id, count in rows.all()}
    return {"plans": {plan_id: counts.get(plan_id, 0) for plan_id in ("PRO", "TEAM")}}


@router.post("/checkout")
async def checkout(
    payload: InterestIn,
    _: object = Depends(require_identity),
) -> dict:
    """Fail closed until a real provider and signed webhook are configured."""

    if not settings.payment_checkout_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "PAYMENT_NOT_CONFIGURED",
                "message": "결제 연동을 준비하고 있어요. 출시 알림을 먼저 신청해 주세요.",
                "planId": payload.planId,
            },
        )
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={
            "code": "PAYMENT_PROVIDER_ADAPTER_MISSING",
            "message": "결제 공급자 어댑터와 서명 검증 웹훅이 아직 연결되지 않았어요.",
            "planId": payload.planId,
        },
    )
