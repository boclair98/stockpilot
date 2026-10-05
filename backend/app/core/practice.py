"""Opt-in, Toss-only practice scope. No header means the legacy ledger.

The caller can select only 'active', never a caller-supplied owner UUID.
League/challenge and web requests retain their original identity.
"""

from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.identity import current_identity
from app.models import PracticeRound, PracticeState


async def optional_practice_identity(
    request: Request, session: AsyncSession = Depends(get_session)
) -> UUID | None:
    identity = current_identity(request)
    scope = request.headers.get("x-stockpilot-practice")
    if not scope:
        return identity.id if identity else None
    if not identity:
        raise HTTPException(401, "로그인이 필요합니다.")
    if identity.provider != "toss" or scope not in {"active", "selected"}:
        raise HTTPException(403, "앱 연습 계좌를 확인할 수 없습니다.")
    query = select(PracticeState).where(PracticeState.owner_id == identity.id)
    if request.method not in {"GET", "HEAD"}:
        query = query.with_for_update()
    state = await session.scalar(query)
    if scope == "selected" and (not state or state.selected_scope == "original"):
        return identity.id
    if not state or not state.active_round_id:
        raise HTTPException(409, "새 연습 계좌를 다시 불러와 주세요.")
    row = await session.scalar(
        select(PracticeRound).where(
            PracticeRound.id == state.active_round_id,
            PracticeRound.owner_id == identity.id,
        )
    )
    if not row:
        raise HTTPException(409, "연습 계좌를 다시 확인해 주세요.")
    return row.ledger_owner_id


async def require_practice_identity(
    owner: UUID | None = Depends(optional_practice_identity),
) -> UUID:
    if not owner:
        raise HTTPException(401, "로그인이 필요합니다.")
    return owner
