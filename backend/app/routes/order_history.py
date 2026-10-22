"""Read-only, owner-scoped history. Viewing a page never executes an order."""

import base64
import binascii
import hashlib
import json
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.practice import require_practice_identity
from app.models import TradeOrder
from app.services.instrument_catalog import instrument_catalog

router = APIRouter()
KST = ZoneInfo("Asia/Seoul")
DOMESTIC_EXCHANGES = ("KRX", "NXT")
US_EXCHANGES = ("NAS", "NYS", "AMS")


def _aware(value: datetime) -> datetime:
    # SQLite test adapters return naive values; PostgreSQL stores timestamptz.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _bad_cursor() -> HTTPException:
    return HTTPException(
        422,
        "조회 위치가 바뀌었어요. 최신 투자 기록부터 다시 불러와 주세요.",
        headers={"Cache-Control": "private, no-store"},
    )


def _cursor(value: str | None, filter_key: str):
    if value is None:
        return datetime.now(UTC), None
    try:
        data = json.loads(base64.b64decode(value, altchars=b"-_", validate=True))
        if (
            not isinstance(data, list)
            or len(data) != 5
            or data[0] != 1
            or not all(isinstance(part, str) for part in data[1:])
            or data[4] != filter_key
        ):
            raise ValueError
        snapshot, at = datetime.fromisoformat(data[1]), datetime.fromisoformat(data[2])
        if snapshot.tzinfo is None or at.tzinfo is None or at > snapshot:
            raise ValueError
        return _aware(snapshot), (_aware(at), UUID(data[3]))
    except (ValueError, TypeError, OverflowError, binascii.Error) as exc:
        raise _bad_cursor() from exc


def _encode_cursor(row: TradeOrder, snapshot: datetime, filter_key: str) -> str:
    data = [
        1,
        snapshot.isoformat(),
        _aware(row.created_at).isoformat(),
        str(row.id),
        filter_key,
    ]
    return base64.urlsafe_b64encode(
        json.dumps(data, separators=(",", ":")).encode()
    ).decode()


def _day_boundary(value: str | None, *, next_day: bool = False):
    if value is None:
        return None
    try:
        day = date.fromisoformat(value)
        # Accept the advertised YYYY-MM-DD form, not Python's compact/ISO-week forms.
        if day.isoformat() != value:
            raise ValueError
        if next_day:
            day += timedelta(days=1)
        return datetime.combine(day, time.min, KST).astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(
            422,
            "조회 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.",
            headers={"Cache-Control": "private, no-store"},
        ) from exc


def _row(row: TradeOrder) -> dict:
    market = (
        "KR"
        if row.exchange in DOMESTIC_EXCHANGES
        else "US"
        if row.exchange in US_EXCHANGES
        else None
    )
    currency = "KRW" if market == "KR" else "USD" if market == "US" else None
    item = instrument_catalog.get_cached(row.symbol, market, row.exchange)
    if item is None and row.exchange == "NXT":
        item = instrument_catalog.get_cached(row.symbol, "KR", "KRX")
    filled = row.status == "FILLED" and row.fill_price is not None
    return {
        "id": str(row.id),
        "symbol": row.symbol,
        "name": item.name if item else None,
        "exchange": row.exchange,
        "market": market,
        "currency": currency,
        "side": row.side,
        "orderType": row.order_type,
        "quantity": float(row.quantity),
        "fillPrice": float(row.fill_price) if row.fill_price is not None else None,
        "fee": float(row.fee),
        "tax": float(row.tax),
        "realizedPnl": float(row.realized_pnl)
        if row.realized_pnl is not None
        else None,
        # Gross execution amount is not settlement cash flow or portfolio return.
        "grossAmount": float(Decimal(row.fill_price) * Decimal(row.quantity))
        if filled
        else None,
        "status": row.status,
        "createdAt": _aware(row.created_at).isoformat(),
    }


@router.get("/orders/history")
async def order_history(
    response: Response,
    limit: int = Query(20, ge=1, le=50),
    cursor: str | None = Query(None, max_length=512),
    q: str = Query("", max_length=100),
    side: Literal["BUY", "SELL"] | None = None,
    status: Literal["OPEN", "FILLED", "REJECTED", "CANCELED"] | None = None,
    market: Literal["KR", "US"] | None = None,
    from_day: str | None = Query(None, alias="from", max_length=10),
    to_day: str | None = Query(None, alias="to", max_length=10),
    owner: UUID = Depends(require_practice_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    start = _day_boundary(from_day)
    end = _day_boundary(to_day, next_day=True)
    if start is not None and end is not None and start >= end:
        raise HTTPException(
            422,
            "시작일은 종료일보다 늦을 수 없어요.",
            headers={"Cache-Control": "private, no-store"},
        )
    needle = q.strip().casefold()
    filter_key = hashlib.sha256(
        json.dumps(
            [str(owner), needle, side, status, market, from_day, to_day],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()[:24]
    snapshot, position = _cursor(cursor, filter_key)
    conditions = [TradeOrder.owner_id == owner, TradeOrder.created_at <= snapshot]
    if position:
        at, identity = position
        conditions.append(
            sa.or_(
                TradeOrder.created_at < at,
                sa.and_(TradeOrder.created_at == at, TradeOrder.id < identity),
            )
        )
    if side:
        conditions.append(TradeOrder.side == side)
    if status:
        conditions.append(TradeOrder.status == status)
    if market:
        exchanges = DOMESTIC_EXCHANGES if market == "KR" else US_EXCHANGES
        conditions.append(TradeOrder.exchange.in_(exchanges))
    if start is not None:
        conditions.append(TradeOrder.created_at >= start)
    if end is not None:
        conditions.append(TradeOrder.created_at < end)
    if needle:
        # Escape LIKE metacharacters: a literal '%' must not reveal all results.
        escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        matching_keys = instrument_catalog.matching_names_cached(needle, market)
        matches = [
            TradeOrder.symbol.ilike(pattern, escape="\\"),
            TradeOrder.exchange.ilike(pattern, escape="\\"),
        ]
        if matching_keys:
            if session.get_bind().dialect.name == "postgresql":
                # A broad one-letter name query must not exceed asyncpg's bind
                # parameter limit; one array per exchange keeps SQL bounded.
                by_exchange: dict[str, list[str]] = {}
                for exchange, symbol in matching_keys:
                    by_exchange.setdefault(exchange, []).append(symbol)
                for exchange, symbols in by_exchange.items():
                    names = sa.bindparam(
                        f"history_names_{exchange}",
                        symbols,
                        type_=sa.ARRAY(sa.String()),
                    )
                    matches.append(
                        sa.and_(
                            TradeOrder.exchange == exchange,
                            TradeOrder.symbol == sa.any_(names),
                        )
                    )
            else:
                matches.append(
                    sa.tuple_(TradeOrder.exchange, TradeOrder.symbol).in_(matching_keys)
                )
        conditions.append(sa.or_(*matches))
    rows = (
        (
            await session.execute(
                sa.select(TradeOrder)
                .where(*conditions)
                .order_by(TradeOrder.created_at.desc(), TradeOrder.id.desc())
                .limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    has_more = len(rows) > limit
    selected = rows[:limit]
    return {
        "items": [_row(row) for row in selected],
        "hasMore": has_more,
        "nextCursor": _encode_cursor(selected[-1], snapshot, filter_key)
        if has_more
        else None,
        "asOf": snapshot.isoformat(),
    }
