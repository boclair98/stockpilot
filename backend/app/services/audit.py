"""Small append-only audit writer kept in the caller's DB transaction."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent


def record_audit(
    session: AsyncSession,
    *,
    actor_id: UUID,
    event_type: str,
    entity_id: UUID,
    request_id: str,
    details: dict,
) -> None:
    session.add(
        AuditEvent(
            actor_id=actor_id,
            event_type=event_type,
            entity_type="trade_order",
            entity_id=entity_id,
            request_id=request_id,
            details=details,
        )
    )
