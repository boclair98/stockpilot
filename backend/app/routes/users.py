"""First-sight Google user upsert + /api/me."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.identity import current_identity, optional_display_name, require_identity
from app.models import (
    AuditEvent,
    DailyChallengeAttempt,
    LeagueParticipant,
    LeagueRankSnapshot,
    LeagueRoomMember,
    PortfolioDailySnapshot,
    Position,
    Post,
    PriceAlert,
    ProtectionPlan,
    PushDevice,
    TradeJournal,
    TradeOrder,
    TradingAccount,
    User,
    WatchlistItem,
)

router = APIRouter(prefix="/api", tags=["users"])


async def upsert_local_user(
    session: AsyncSession, coders_id: UUID, platform_name: str | None = None
) -> User:
    """Insert-on-first-sight; otherwise bump last_seen_at. When the visitor set a
    display name on coders.kr (`platform_name`), use it and keep it in sync;
    otherwise fall back to a generated `user-<id8>` handle."""
    name = platform_name or f"user-{str(coders_id)[:8]}"
    stmt = pg_insert(User).values(coders_id=coders_id, display_name=name)
    if platform_name:
        stmt = stmt.on_conflict_do_update(
            index_elements=["coders_id"], set_={"display_name": platform_name}
        )
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=["coders_id"])
    await session.execute(stmt)
    res = await session.execute(select(User).where(User.coders_id == coders_id))
    user = res.scalar_one()
    # Touch last_seen_at (the onupdate trigger fires when we modify anything).
    user.display_name = user.display_name
    return user


@router.get("/me")
async def me(
    request: Request,
    coders_id: UUID = Depends(require_identity),
    platform_name: str | None = Depends(optional_display_name),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return the signed-in Google user's app-local row."""
    user = await upsert_local_user(session, coders_id, platform_name)
    identity = current_identity(request)
    return {
        "id": str(user.id),
        "coders_id": str(user.coders_id),
        "display_name": user.display_name,
        "email": identity.email if identity else None,
        "picture": identity.picture if identity else None,
        "provider": "google",
        "first_seen_at": user.first_seen_at.isoformat(),
    }


def _export_value(value: object) -> object:
    if isinstance(value, (UUID, datetime)):
        return str(value) if isinstance(value, UUID) else value.isoformat()
    if hasattr(value, "as_tuple"):  # Decimal without importing another type.
        return str(value)
    return value


def _export_rows(rows: list[object], fields: tuple[str, ...]) -> list[dict]:
    return [
        {field: _export_value(getattr(row, field, None)) for field in fields}
        for row in rows
    ]


@router.get("/me/export")
async def export_my_data(
    request: Request,
    coders_id: UUID = Depends(require_identity),
    platform_name: str | None = Depends(optional_display_name),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Download a privacy-safe copy of the signed-in user's app data."""

    user = await upsert_local_user(session, coders_id, platform_name)

    async def owner_rows(
        model: type, *, field: str = "owner_id", value: UUID = coders_id
    ) -> list[object]:
        result = await session.execute(
            select(model).where(getattr(model, field) == value)
        )
        return list(result.scalars().all())

    posts = list(
        (
            await session.execute(
                select(Post)
                .where(Post.author_id == user.id)
                .order_by(Post.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    account = await session.scalar(
        select(TradingAccount).where(TradingAccount.owner_id == coders_id)
    )
    participant = await session.scalar(
        select(LeagueParticipant).where(LeagueParticipant.owner_id == coders_id)
    )

    specs = (
        ("positions", Position, ("id", "symbol", "exchange", "quantity", "average_price")),
        ("orders", TradeOrder, ("id", "symbol", "exchange", "side", "order_type", "quantity", "limit_price", "trigger_price", "fill_price", "fee", "tax", "realized_pnl", "risk_code", "reject_reason", "status", "created_at")),
        ("protectionPlans", ProtectionPlan, ("id", "symbol", "exchange", "quantity", "take_profit_price", "stop_loss_price", "status", "trigger_reason", "triggered_at", "created_at")),
        ("watchlist", WatchlistItem, ("id", "symbol", "exchange", "created_at")),
        ("priceAlerts", PriceAlert, ("id", "symbol", "exchange", "direction", "target_price", "status", "triggered_at", "read_at", "created_at")),
        ("dailyChallenges", DailyChallengeAttempt, ("id", "challenge_date", "symbol", "exchange", "choice", "score", "created_at")),
        ("journals", TradeJournal, ("id", "symbol", "exchange", "thesis", "horizon", "target_return", "stop_loss", "confidence", "review", "outcome", "created_at", "reviewed_at")),
        ("portfolioSnapshots", PortfolioDailySnapshot, ("id", "snapshot_date", "equity_krw", "equity_usd", "return_rate", "created_at")),
        ("leagueSnapshots", LeagueRankSnapshot, ("id", "participant_id", "snapshot_date", "rank", "return_rate", "created_at"), "participant_id"),
        ("leagueMemberships", LeagueRoomMember, ("id", "league_id", "nickname", "baseline_krw", "baseline_usd", "joined_at")),
        ("auditEvents", AuditEvent, ("id", "event_type", "entity_type", "entity_id", "request_id", "details", "created_at"), "actor_id"),
    )
    tables: dict[str, list[dict]] = {
        "posts": _export_rows(posts, ("id", "body", "created_at")),
        "pushDevices": [],  # Tokens are intentionally never placed in downloads.
    }
    for spec in specs:
        name, model, fields, *field_override = spec
        if field_override:
            if field_override[0] == "participant_id" and participant:
                rows = await owner_rows(model, field="participant_id", value=participant.id)
            elif field_override[0] == "actor_id":
                rows = await owner_rows(model, field="actor_id")
            else:
                rows = []
        else:
            rows = await owner_rows(model)
        tables[name] = _export_rows(rows, fields)
    push_devices = await owner_rows(PushDevice)
    tables["pushDevices"] = _export_rows(
        push_devices, ("id", "user_agent", "enabled", "last_seen_at", "created_at")
    )

    identity = current_identity(request)
    content = {
        "schemaVersion": 1,
        "exportedAt": datetime.now(UTC).isoformat(),
        "service": "StockPilot",
        "account": {
            "id": str(user.id),
            "codersId": str(user.coders_id),
            "displayName": user.display_name,
            "email": identity.email if identity else None,
            "provider": "google",
        },
        "tradingAccount": _export_rows(
            [account] if account else [], ("owner_id", "cash", "cash_krw")
        ),
        "leagueProfile": _export_rows(
            [participant] if participant else [], ("id", "nickname", "joined_at", "active")
        ),
        "tables": tables,
        "privacyNote": "푸시 기기 토큰은 보안상 포함하지 않았습니다. 모든 주문·잔액은 가상원장 데이터입니다.",
    }
    return JSONResponse(
        content=content,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'attachment; filename="stockpilot-data-export.json"',
        },
    )
