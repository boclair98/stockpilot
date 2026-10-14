"""Owner-scoped personal tools; never calls a real-order broker endpoint."""

import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_session
from app.core.identity import require_identity, require_operator
from app.core.order_integrity import normalize_idempotency_key, request_fingerprint
from app.core.traffic import traffic_store
from app.models import PriceAlert, TradeOrder, WatchlistItem
from app.personal_models import (
    CorporateAction,
    InboxRead,
    MoneyEvent,
    RecurringPlan,
    RecurringRun,
    SavedItem,
    ServiceNotice,
    SupportTicket,
)
from app.routes.trading import account, quantity_text
from app.services.instrument_catalog import instrument_catalog
from app.services.personal_data import corporate_schedule, reference_fx
from app.services.personal_ledger import book_fx, require_simulation
from app.services.personal_math import (
    aware,
    fx_amount,
    next_weekly,
    verified_source_url,
)

router = APIRouter(prefix="/api/personal", tags=["personal"])


def private(response: Response):
    response.headers["Cache-Control"] = "private, no-store"


def stamp(value):
    return aware(value).isoformat() if value else None


def key_check(key):
    try:
        return normalize_idempotency_key(key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


async def instrument(symbol, exchange, market=None):
    if (
        not isinstance(symbol, str)
        or not 1 <= len(symbol) <= 12
        or not isinstance(exchange, str)
        or not 3 <= len(exchange) <= 8
        or (
            market is not None
            and (not isinstance(market, str) or market not in {"KR", "US"})
        )
    ):
        raise HTTPException(422, "종목 코드와 거래소를 확인해 주세요.")
    row = await instrument_catalog.get(symbol, market=market, exchange=exchange)
    if not row:
        raise HTTPException(404, "종목을 찾지 못했어요.")
    return row


def saved_view(row):
    return {
        "key": row.key,
        "data": row.data,
        "version": row.version,
        "deleted": row.deleted,
        "updatedAt": stamp(row.updated_at),
    }


class SavedIn(BaseModel):
    data: dict
    version: int = Field(ge=0)


async def canonical_saved(kind, key, data):
    if len(key) > 200:
        raise HTTPException(422, "저장 식별자가 너무 길어요.")
    if kind == "FAVORITE":
        row = await instrument(
            data.get("symbol", ""), data.get("exchange", ""), data.get("market")
        )
        if key != row.id:
            raise HTTPException(422, "종목 식별자를 확인해 주세요.")
        return row.public()
    if kind == "NOTE":
        parts = key.split(":")
        if len(parts) != 2:
            raise HTTPException(422, "기록 종목을 확인해 주세요.")
        await instrument(parts[1], parts[0])
        note = data.get("note")
        if not isinstance(note, str) or len(note) > 1200:
            raise HTTPException(422, "메모는 1,200자까지 입력할 수 있어요.")
        return {"note": note}
    if kind == "COMPARE":
        rows = data.get("instruments", [])
        note = data.get("note", "")
        if (
            not isinstance(rows, list)
            or not 2 <= len(rows) <= 3
            or not isinstance(note, str)
            or len(note) > 1200
        ):
            raise HTTPException(422, "종목 2~3개와 1,200자 이내 메모를 확인해 주세요.")
        selected = [
            await instrument(
                item.get("symbol", ""), item.get("exchange", ""), item.get("market")
            )
            for item in rows
            if isinstance(item, dict)
        ]
        if (
            len(selected) != len(rows)
            or len({row.id for row in selected}) != len(rows)
            or key != ",".join(row.id for row in selected)
        ):
            raise HTTPException(422, "비교 종목 식별자를 확인해 주세요.")
        return {
            "id": key,
            "name": " · ".join(row.name for row in selected),
            "instruments": [row.public() for row in selected],
            "note": note,
        }
    raise HTTPException(422, "저장 유형을 확인해 주세요.")


@router.get("/saved")
async def saved_list(
    response: Response,
    kind: Literal["FAVORITE", "NOTE", "COMPARE"],
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    rows = list(
        (
            await session.scalars(
                sa.select(SavedItem)
                .where(SavedItem.owner_id == owner, SavedItem.kind == kind)
                .order_by(SavedItem.updated_at.desc())
                .limit(201)
            )
        ).all()
    )
    result = [saved_view(row) for row in rows]
    if kind == "FAVORITE":
        existing = {row.key for row in rows}
        legacy = list(
            (
                await session.scalars(
                    sa.select(WatchlistItem)
                    .where(WatchlistItem.owner_id == owner)
                    .limit(50)
                )
            ).all()
        )
        for entry in legacy:
            item = await instrument_catalog.get(entry.symbol, exchange=entry.exchange)
            if item and item.id not in existing:
                result.append(
                    {
                        "key": item.id,
                        "data": item.public(),
                        "version": 0,
                        "deleted": False,
                        "updatedAt": None,
                    }
                )
    return {"items": result, "owner": str(owner)}


@router.put("/saved/{kind}/{key:path}")
async def saved_put(
    kind: str,
    key: str,
    payload: SavedIn,
    response: Response,
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    data = await canonical_saved(kind, key, payload.data)
    await account(
        session, owner, lock=True
    )  # serialize caps and missing-row creation per owner
    row = await session.get(SavedItem, (owner, kind, key))
    if row and kind != "FAVORITE" and row.version != payload.version:
        raise HTTPException(
            409,
            {
                "message": "다른 기기에서 수정했어요. 새 기록을 불러온 뒤 다시 저장해 주세요.",
                "current": saved_view(row),
            },
        )
    if not row and payload.version != 0:
        raise HTTPException(409, "저장 버전을 확인해 주세요.")
    if not row or row.deleted:
        count = await session.scalar(
            sa.select(sa.func.count())
            .select_from(SavedItem)
            .where(
                SavedItem.owner_id == owner,
                SavedItem.kind == kind,
                SavedItem.deleted.is_(False),
            )
        )
        if kind == "FAVORITE":
            legacy = await session.scalar(
                sa.select(sa.func.count())
                .select_from(WatchlistItem)
                .where(WatchlistItem.owner_id == owner)
            )
            already = await session.scalar(
                sa.select(WatchlistItem.id).where(
                    WatchlistItem.owner_id == owner,
                    WatchlistItem.symbol == data["symbol"],
                    WatchlistItem.exchange == data["exchange"],
                )
            )
            if legacy >= 50 and already is None:
                raise HTTPException(409, "관심종목은 최대 50개까지 저장할 수 있어요.")
        if count >= {"FAVORITE": 50, "NOTE": 200, "COMPARE": 10}[kind]:
            raise HTTPException(
                409, "저장 한도에 도달했어요. 기존 항목을 정리해 주세요."
            )
    if row is None:
        row = SavedItem(owner_id=owner, kind=kind, key=key, version=0, data={})
        session.add(row)
    row.data, row.deleted, row.version, row.updated_at = (
        data,
        False,
        row.version + 1,
        datetime.now(UTC),
    )
    if kind == "FAVORITE":
        old = await session.scalar(
            sa.select(WatchlistItem).where(
                WatchlistItem.owner_id == owner,
                WatchlistItem.symbol == data["symbol"],
                WatchlistItem.exchange == data["exchange"],
            )
        )
        if old is None:
            session.add(
                WatchlistItem(
                    owner_id=owner, symbol=data["symbol"], exchange=data["exchange"]
                )
            )
    await session.flush()
    return saved_view(row)


@router.delete("/saved/{kind}/{key:path}")
async def saved_delete(
    kind: Literal["FAVORITE", "NOTE", "COMPARE"],
    key: str,
    response: Response,
    version: int = Query(ge=0),
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    if len(key) > 200:
        raise HTTPException(422, "식별자를 확인해 주세요.")
    await account(session, owner, lock=True)
    row = await session.get(SavedItem, (owner, kind, key))
    if row and kind != "FAVORITE" and row.version != version:
        raise HTTPException(409, "다른 기기의 변경이 있어요. 먼저 새로 조회해 주세요.")
    if row is None:
        if kind != "FAVORITE" or len(key.split(":")) != 3:
            raise HTTPException(404, "저장 항목이 없어요. 먼저 조회해 주세요.")
        market, exchange, symbol = key.split(":")
        item = await instrument(symbol, exchange, market)
        row = SavedItem(
            owner_id=owner, kind=kind, key=key, data=item.public(), version=0
        )
        session.add(row)
    row.deleted, row.version, row.updated_at = True, row.version + 1, datetime.now(UTC)
    if kind == "FAVORITE":
        await session.execute(
            sa.delete(WatchlistItem).where(
                WatchlistItem.owner_id == owner,
                WatchlistItem.symbol == row.data["symbol"],
                WatchlistItem.exchange == row.data["exchange"],
            )
        )
    await session.flush()
    return saved_view(row)


def ticket_view(row):
    return {
        "id": str(row.id),
        "category": row.category,
        "subject": row.subject,
        "body": row.body,
        "reply": row.reply,
        "status": row.status,
        "createdAt": stamp(row.created_at),
        "updatedAt": stamp(row.updated_at),
    }


def safe_text(value):
    value = value.strip()
    if (
        not value
        or "\x00" in value
        or re.search(
            r"(?:BEGIN .*PRIVATE KEY|gh[pousr]_|cdrs_|AIza|Bearer\s+[\w.-]{20})",
            value,
            re.I,
        )
    ):
        raise ValueError("빈 내용이나 인증정보는 보낼 수 없어요.")
    return value


class TicketIn(BaseModel):
    requestKey: str = Field(min_length=8, max_length=128)
    category: Literal["BUG", "ORDER", "ACCOUNT", "IDEA"]
    subject: str = Field(min_length=2, max_length=80)
    body: str = Field(min_length=5, max_length=2000)
    _safe = field_validator("subject", "body")(safe_text)


@router.get("/support")
async def tickets(
    response: Response,
    offset: int = Query(0, ge=0, le=10000),
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    rows = list(
        (
            await session.scalars(
                sa.select(SupportTicket)
                .where(SupportTicket.owner_id == owner)
                .order_by(SupportTicket.created_at.desc())
                .offset(offset)
                .limit(21)
            )
        ).all()
    )
    return {"items": [ticket_view(row) for row in rows[:20]], "hasMore": len(rows) > 20}


@router.post("/support")
async def ticket_create(
    payload: TicketIn,
    response: Response,
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    key = key_check(payload.requestKey)
    fingerprint = request_fingerprint(payload.model_dump(exclude={"requestKey"}))
    await account(session, owner, lock=True)
    row = await session.scalar(
        sa.select(SupportTicket).where(
            SupportTicket.owner_id == owner, SupportTicket.request_key == key
        )
    )
    if row:
        if row.fingerprint != fingerprint:
            raise HTTPException(409, "다른 내용에 같은 요청 번호를 사용할 수 없어요.")
        return ticket_view(row)
    count = await session.scalar(
        sa.select(sa.func.count())
        .select_from(SupportTicket)
        .where(SupportTicket.owner_id == owner, SupportTicket.status != "CLOSED")
    )
    if count >= 10:
        raise HTTPException(
            409, "진행 중인 문의가 10개예요. 기존 문의의 답변을 확인해 주세요."
        )
    row = SupportTicket(
        owner_id=owner,
        request_key=key,
        fingerprint=fingerprint,
        category=payload.category,
        subject=payload.subject,
        body=payload.body,
    )
    session.add(row)
    await session.flush()
    return ticket_view(row)


@router.get("/notices")
async def notices(session=Depends(get_session)):
    rows = list(
        (
            await session.scalars(
                sa.select(ServiceNotice)
                .where(ServiceNotice.active.is_(True))
                .order_by(ServiceNotice.created_at.desc())
                .limit(20)
            )
        ).all()
    )
    return {
        "items": [
            {
                "id": str(row.id),
                "title": row.title,
                "body": row.body,
                "severity": row.severity,
                "createdAt": stamp(row.created_at),
            }
            for row in rows
        ]
    }


@router.get("/inbox")
async def inbox(
    response: Response,
    category: Literal["ALL", "ORDER", "PRICE", "ACCOUNT", "SUPPORT"] = "ALL",
    before: datetime | None = None,
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    events = []
    end = aware(before) if before else datetime.now(UTC) + timedelta(seconds=1)

    def add(key, kind, title, body, at, href):
        if at and aware(at) < end:
            events.append(
                {
                    "key": key,
                    "category": kind,
                    "title": title,
                    "body": body,
                    "at": stamp(at),
                    "href": href,
                }
            )

    if category in {"ALL", "ORDER"}:
        date = sa.func.coalesce(TradeOrder.processed_at, TradeOrder.created_at)
        rows = list(
            (
                await session.scalars(
                    sa.select(TradeOrder)
                    .where(TradeOrder.owner_id == owner, date < end)
                    .order_by(date.desc())
                    .limit(51)
                )
            ).all()
        )
        states = {
            "OPEN": "접수",
            "TRIGGERED": "조건 충족",
            "FILLED": "체결",
            "REJECTED": "거절",
            "CANCELED": "취소",
        }
        for row in rows:
            add(
                f"order:{row.id}:{row.status}",
                "ORDER",
                f"{row.symbol} 모의 주문 {states.get(row.status, row.status)}",
                row.reject_reason
                or f"{'매수' if row.side == 'BUY' else '매도'} {quantity_text(Decimal(row.quantity))}주",
                row.processed_at or row.created_at,
                "/#orders",
            )
    if category in {"ALL", "PRICE"}:
        rows = list(
            (
                await session.scalars(
                    sa.select(PriceAlert)
                    .where(
                        PriceAlert.owner_id == owner,
                        PriceAlert.status == "TRIGGERED",
                        PriceAlert.triggered_at < end,
                    )
                    .order_by(PriceAlert.triggered_at.desc())
                    .limit(51)
                )
            ).all()
        )
        for row in rows:
            add(
                f"price:{row.id}",
                "PRICE",
                f"{row.symbol} 목표 가격 도달",
                f"{row.target_price:,.2f} {'이상' if row.direction == 'ABOVE' else '이하'}",
                row.triggered_at,
                f"/?view=detail&symbol={row.symbol}&exchange={row.exchange}#instrument-workspace",
            )
    if category in {"ALL", "ACCOUNT"}:
        for row in list(
            (
                await session.scalars(
                    sa.select(MoneyEvent)
                    .where(
                        MoneyEvent.owner_id == owner,
                        MoneyEvent.status.notin_(["QUOTED", "NO_ENTITLEMENT"]),
                        MoneyEvent.updated_at < end,
                    )
                    .order_by(MoneyEvent.updated_at.desc())
                    .limit(51)
                )
            ).all()
        ):
            add(
                f"money:{row.id}:{row.status}",
                "ACCOUNT",
                {"FX": "가상 환전", "DIVIDEND": "모의 배당", "SPLIT": "주식 분할"}.get(
                    row.kind, row.kind
                ),
                row.data.get("message", row.status),
                row.updated_at,
                "/account-tools",
            )
        for row in list(
            (
                await session.scalars(
                    sa.select(RecurringRun)
                    .where(
                        RecurringRun.owner_id == owner, RecurringRun.created_at < end
                    )
                    .order_by(RecurringRun.created_at.desc())
                    .limit(51)
                )
            ).all()
        ):
            add(
                f"recurring:{row.id}",
                "ACCOUNT",
                "정기 모의 매수 실행 기록",
                row.reason,
                row.created_at,
                "/account-tools",
            )
    if category in {"ALL", "SUPPORT"}:
        for row in list(
            (
                await session.scalars(
                    sa.select(SupportTicket)
                    .where(
                        SupportTicket.owner_id == owner,
                        SupportTicket.reply.is_not(None),
                        SupportTicket.updated_at < end,
                    )
                    .order_by(SupportTicket.updated_at.desc())
                    .limit(51)
                )
            ).all()
        ):
            add(
                f"support:{row.id}:{stamp(row.updated_at)}",
                "SUPPORT",
                f"문의 답변 · {row.subject}",
                row.reply,
                row.updated_at,
                "/support",
            )
    events.sort(key=lambda item: (item["at"], item["key"]), reverse=True)
    selected = events[:50]
    read = set(
        (
            await session.scalars(
                sa.select(InboxRead.key).where(
                    InboxRead.owner_id == owner,
                    InboxRead.key.in_([row["key"] for row in selected]),
                )
            )
        ).all()
    )
    for row in selected:
        row["read"] = row["key"] in read
    return {
        "items": selected,
        "hasMore": len(events) > 50,
        "nextBefore": selected[-1]["at"] if len(events) > 50 else None,
    }


class ReadIn(BaseModel):
    keys: list[str] = Field(max_length=50)


@router.post("/inbox/read")
async def inbox_read(
    payload: ReadIn, owner=Depends(require_identity), session=Depends(get_session)
):
    await account(session, owner, lock=True)
    for key in set(payload.keys):
        if len(key) > 200 or not re.fullmatch(
            r"(?:order|price|money|recurring|support):[a-zA-Z0-9:.+-]+", key
        ):
            raise HTTPException(422, "알림 식별자를 확인해 주세요.")
        kind, raw_id, *_ = key.split(":")
        try:
            event_id = UUID(raw_id)
        except ValueError as exc:
            raise HTTPException(422, "알림 식별자를 확인해 주세요.") from exc
        model = {
            "order": TradeOrder,
            "price": PriceAlert,
            "money": MoneyEvent,
            "recurring": RecurringRun,
            "support": SupportTicket,
        }[kind]
        actual = await session.scalar(
            sa.select(model).where(model.id == event_id, model.owner_id == owner)
        )
        if actual is None:
            raise HTTPException(404, "내 계정의 알림이 아니에요.")
        if kind == "price":
            actual.read_at = datetime.now(UTC)
        if await session.get(InboxRead, (owner, key)) is None:
            session.add(InboxRead(owner_id=owner, key=key))
    return {"read": True}


@router.get("/disclosures")
async def disclosures(
    response: Response,
    offset: int = Query(0, ge=0, le=50),
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    from app.services.dart_company import dart_company
    from app.services.sec_company import sec_company

    private(response)
    saved = list(
        (
            await session.scalars(
                sa.select(WatchlistItem)
                .where(WatchlistItem.owner_id == owner)
                .order_by(WatchlistItem.symbol)
                .offset(offset)
                .limit(4)
            )
        ).all()
    )
    rows, failed = [], []
    for row in saved[:3]:
        item = await instrument_catalog.get(row.symbol, exchange=row.exchange)
        if not item:
            continue
        try:
            data = await (
                dart_company.company(item.symbol)
                if item.market == "KR"
                else sec_company.company(item.symbol)
            )
            rows.append(
                {
                    "instrument": item.public(),
                    "items": data.get("disclosures", []),
                    "asOf": data.get("asOf"),
                    "source": "DART" if item.market == "KR" else "SEC",
                }
            )
        except Exception:
            failed.append(item.name)
    return {"groups": rows, "failed": failed, "hasMore": len(saved) > 3}


@router.get("/fx/rate")
async def fx_rate():
    try:
        return await reference_fx()
    except Exception as exc:
        raise HTTPException(
            503, "기준환율을 확인하지 못했어요. 잠시 후 다시 조회해 주세요."
        ) from exc


class FxIn(BaseModel):
    requestKey: str = Field(min_length=8, max_length=128)
    direction: Literal["KRW_TO_USD", "USD_TO_KRW"]
    amount: Decimal = Field(gt=0, le=1_000_000_000)


def money_view(row):
    return {
        "id": str(row.id),
        "kind": row.kind,
        "status": row.status,
        "data": row.data,
        "expiresAt": stamp(row.expires_at),
        "createdAt": stamp(row.created_at),
    }


@router.post("/fx/quote")
async def fx_quote(
    payload: FxIn,
    response: Response,
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    key = key_check(payload.requestKey)
    await require_simulation(session)
    rate = await fx_rate()
    try:
        received = fx_amount(payload.amount, payload.direction, rate["rate"])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    await account(session, owner, lock=True)
    row = await session.scalar(
        sa.select(MoneyEvent).where(
            MoneyEvent.owner_id == owner,
            MoneyEvent.kind == "FX",
            MoneyEvent.request_key == key,
        )
    )
    fingerprint = request_fingerprint(payload.model_dump(exclude={"requestKey"}))
    if row:
        if row.data["fingerprint"] != fingerprint:
            raise HTTPException(409, "다른 금액에 같은 요청 번호를 사용할 수 없어요.")
        return money_view(row)
    now = datetime.now(UTC)
    row = MoneyEvent(
        owner_id=owner,
        kind="FX",
        request_key=key,
        status="QUOTED",
        data={
            **rate,
            "direction": payload.direction,
            "amount": str(payload.amount),
            "received": str(received),
            "fingerprint": fingerprint,
            "fee": "0",
        },
        expires_at=now + timedelta(seconds=120),
    )
    session.add(row)
    await session.flush()
    return money_view(row)


@router.post("/fx/{quote_id}/confirm")
async def fx_confirm(
    quote_id: UUID,
    response: Response,
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    return money_view(await book_fx(session, owner, quote_id))


@router.get("/money")
async def money_history(
    response: Response,
    offset: int = Query(0, ge=0, le=10000),
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    rows = list(
        (
            await session.scalars(
                sa.select(MoneyEvent)
                .where(
                    MoneyEvent.owner_id == owner,
                    MoneyEvent.status.notin_(["QUOTED", "NO_ENTITLEMENT"]),
                )
                .order_by(MoneyEvent.created_at.desc())
                .offset(offset)
                .limit(21)
            )
        ).all()
    )
    return {"items": [money_view(row) for row in rows[:20]], "hasMore": len(rows) > 20}


class PlanIn(BaseModel):
    requestKey: str = Field(min_length=8, max_length=128)
    symbol: str = Field(min_length=1, max_length=12)
    market: Literal["KR", "US"]
    exchange: str = Field(min_length=3, max_length=8)
    amount: Decimal = Field(gt=0, le=50_000_000)
    weekday: int = Field(ge=0, le=4)
    localTime: str = Field(pattern=r"^\d{2}:\d{2}$")


def plan_view(row):
    return {
        "id": str(row.id),
        "name": row.name,
        "symbol": row.symbol,
        "exchange": row.exchange,
        "market": row.market,
        "currency": row.currency,
        "amount": str(row.amount),
        "weekday": row.weekday,
        "localTime": row.local_time,
        "timezone": row.timezone,
        "active": row.active,
        "nextAt": stamp(row.next_at),
    }


@router.get("/recurring")
async def plans(
    response: Response, owner=Depends(require_identity), session=Depends(get_session)
):
    private(response)
    rows = list(
        (
            await session.scalars(
                sa.select(RecurringPlan)
                .where(RecurringPlan.owner_id == owner)
                .order_by(RecurringPlan.created_at.desc())
                .limit(100)
            )
        ).all()
    )
    runs = list(
        (
            await session.scalars(
                sa.select(RecurringRun)
                .where(RecurringRun.owner_id == owner)
                .order_by(RecurringRun.created_at.desc())
                .limit(50)
            )
        ).all()
    )
    return {
        "items": [plan_view(row) for row in rows],
        "runs": [
            {
                "id": str(row.id),
                "planId": str(row.plan_id),
                "dueAt": stamp(row.due_at),
                "status": row.status,
                "reason": row.reason,
                "orderId": str(row.order_id) if row.order_id else None,
            }
            for row in runs
        ],
        "worker": await traffic_store.get_json("personal:worker:heartbeat"),
    }


@router.post("/recurring")
async def plan_create(
    payload: PlanIn,
    response: Response,
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    private(response)
    item = await instrument(payload.symbol, payload.exchange, payload.market)
    zone = "Asia/Seoul" if item.market == "KR" else "America/New_York"
    if not (
        "09:00" <= payload.localTime <= "15:00"
        if item.market == "KR"
        else "09:30" <= payload.localTime <= "15:50"
    ):
        raise HTTPException(422, "현지 정규 거래 시간 안에서 선택해 주세요.")
    if item.currency == "USD" and payload.amount > 50000:
        raise HTTPException(422, "달러 정기 매수 예산은 50,000달러까지예요.")
    unit = Decimal("1") if item.currency == "KRW" else Decimal("0.01")
    if payload.amount != payload.amount.quantize(unit):
        raise HTTPException(
            422, "원화는 정수, 달러는 소수 둘째 자리까지 입력해 주세요."
        )
    key = key_check(payload.requestKey)
    fp = request_fingerprint(payload.model_dump(exclude={"requestKey"}))
    await require_simulation(session)
    await account(session, owner, lock=True)
    row = await session.scalar(
        sa.select(RecurringPlan).where(
            RecurringPlan.owner_id == owner, RecurringPlan.request_key == key
        )
    )
    if row:
        if row.fingerprint != fp:
            raise HTTPException(409, "다른 설정에 같은 요청 번호를 사용할 수 없어요.")
        return plan_view(row)
    count = await session.scalar(
        sa.select(sa.func.count())
        .select_from(RecurringPlan)
        .where(RecurringPlan.owner_id == owner, RecurringPlan.active.is_(True))
    )
    total = await session.scalar(
        sa.select(sa.func.count())
        .select_from(RecurringPlan)
        .where(RecurringPlan.owner_id == owner)
    )
    if count >= 10 or total >= 100:
        raise HTTPException(
            409, "정기 매수는 활성 10개, 전체 100개까지 등록할 수 있어요."
        )
    row = RecurringPlan(
        owner_id=owner,
        request_key=key,
        fingerprint=fp,
        symbol=item.symbol,
        market=item.market,
        exchange=item.exchange,
        name=item.name,
        currency=item.currency,
        amount=payload.amount,
        weekday=payload.weekday,
        local_time=payload.localTime,
        timezone=zone,
        next_at=next_weekly(
            datetime.now(UTC), payload.weekday, payload.localTime, zone
        ),
    )
    session.add(row)
    await session.flush()
    return plan_view(row)


class ActiveIn(BaseModel):
    active: bool


@router.patch("/recurring/{plan_id}")
async def plan_active(
    plan_id: UUID,
    payload: ActiveIn,
    owner=Depends(require_identity),
    session=Depends(get_session),
):
    await account(session, owner, lock=True)
    row = await session.scalar(
        sa.select(RecurringPlan)
        .where(RecurringPlan.id == plan_id, RecurringPlan.owner_id == owner)
        .with_for_update()
    )
    if not row:
        raise HTTPException(404, "정기 매수 설정이 없어요.")
    if payload.active and not row.active:
        count = await session.scalar(
            sa.select(sa.func.count())
            .select_from(RecurringPlan)
            .where(RecurringPlan.owner_id == owner, RecurringPlan.active.is_(True))
        )
        if count >= 10:
            raise HTTPException(409, "활성 설정은 10개까지예요.")
        row.next_at = next_weekly(
            datetime.now(UTC), row.weekday, row.local_time, row.timezone
        )
    row.active = payload.active
    return plan_view(row)


@router.get("/corporate")
async def corporate(symbol: str, exchange: str, session=Depends(get_session)):
    item = await instrument(symbol, exchange)
    try:
        schedule = await corporate_schedule(item)
    except Exception:
        schedule = {
            "items": [],
            "partial": True,
            "note": "권리 일정을 조회하지 못했어요. 잠시 후 다시 확인해 주세요.",
        }
    rows = list(
        (
            await session.scalars(
                sa.select(CorporateAction)
                .where(
                    CorporateAction.symbol == item.symbol,
                    CorporateAction.exchange == item.exchange,
                    CorporateAction.status == "VERIFIED",
                )
                .order_by(CorporateAction.pay_at.desc())
                .limit(50)
            )
        ).all()
    )
    return {**schedule, "verified": [action_view(row) for row in rows]}


def action_view(row):
    return {
        "id": str(row.id),
        "symbol": row.symbol,
        "exchange": row.exchange,
        "currency": row.currency,
        "kind": row.kind,
        "perShare": str(row.per_share) if row.per_share is not None else None,
        "ratio": str(row.ratio) if row.ratio is not None else None,
        "cutoffAt": stamp(row.cutoff_at),
        "payAt": stamp(row.pay_at),
        "sourceUrl": row.source_url,
        "status": row.status,
    }


class ReplyIn(BaseModel):
    reply: str = Field(min_length=2, max_length=2000)
    status: Literal["ANSWERED", "CLOSED"]
    _safe = field_validator("reply")(safe_text)


@router.get("/operations")
async def operator_list(
    response: Response,
    offset: int = Query(0, ge=0, le=10000),
    operator=Depends(require_operator),
    session=Depends(get_session),
):
    private(response)
    rows = list(
        (
            await session.scalars(
                sa.select(SupportTicket)
                .order_by(SupportTicket.created_at.desc())
                .offset(offset)
                .limit(21)
            )
        ).all()
    )
    return {
        "tickets": [ticket_view(row) for row in rows[:20]],
        "hasMore": len(rows) > 20,
        "actions": [
            action_view(row)
            for row in (
                await session.scalars(
                    sa.select(CorporateAction)
                    .where(
                        CorporateAction.cutoff_at > datetime.now(UTC),
                        CorporateAction.status == "VERIFIED",
                    )
                    .order_by(CorporateAction.cutoff_at)
                    .limit(50)
                )
            ).all()
        ],
        "notices": [
            {"id": str(row.id), "title": row.title, "active": row.active}
            for row in (
                await session.scalars(
                    sa.select(ServiceNotice)
                    .order_by(ServiceNotice.created_at.desc())
                    .limit(50)
                )
            ).all()
        ],
    }


@router.patch("/operations/support/{ticket_id}")
async def operator_reply(
    ticket_id: UUID,
    payload: ReplyIn,
    operator=Depends(require_operator),
    session=Depends(get_session),
):
    row = await session.get(SupportTicket, ticket_id, with_for_update=True)
    if not row:
        raise HTTPException(404, "문의가 없어요.")
    row.reply, row.status, row.updated_at = (
        payload.reply,
        payload.status,
        datetime.now(UTC),
    )
    return ticket_view(row)


class NoticeIn(BaseModel):
    requestKey: str = Field(min_length=8, max_length=128)
    title: str = Field(min_length=2, max_length=80)
    body: str = Field(min_length=5, max_length=2000)
    severity: Literal["INFO", "WARNING"] = "INFO"
    _safe = field_validator("title", "body")(safe_text)


@router.post("/operations/notices")
async def operator_notice(
    payload: NoticeIn, operator=Depends(require_operator), session=Depends(get_session)
):
    from uuid import NAMESPACE_URL, uuid5

    notice_id = uuid5(
        NAMESPACE_URL,
        f"stockpilot:notice:{operator.id}:{key_check(payload.requestKey)}",
    )
    from app.services.risk_engine import load_control

    await load_control(session, lock=True)
    row = await session.get(ServiceNotice, notice_id)
    if row:
        if (
            row.title != payload.title
            or row.body != payload.body
            or row.severity != payload.severity
        ):
            raise HTTPException(409, "같은 요청 번호의 공지 내용이 달라요.")
        return {"id": str(row.id)}
    row = ServiceNotice(id=notice_id, **payload.model_dump(exclude={"requestKey"}))
    session.add(row)
    await session.flush()
    return {"id": str(row.id)}


@router.patch("/operations/notices/{notice_id}")
async def operator_notice_active(
    notice_id: UUID,
    payload: ActiveIn,
    operator=Depends(require_operator),
    session=Depends(get_session),
):
    row = await session.get(ServiceNotice, notice_id, with_for_update=True)
    if not row:
        raise HTTPException(404, "공지사항이 없어요.")
    row.active = payload.active
    return {"active": row.active}


class ActionIn(BaseModel):
    sourceKey: str = Field(min_length=8, max_length=128)
    symbol: str = Field(min_length=1, max_length=12)
    exchange: str = Field(min_length=3, max_length=8)
    kind: Literal["DIVIDEND", "SPLIT"]
    perShare: Decimal | None = Field(default=None, gt=0, le=1_000_000, decimal_places=6)
    ratio: Decimal | None = Field(default=None, gt=0, le=1000, decimal_places=8)
    cutoffAt: datetime
    payAt: datetime
    sourceUrl: str = Field(max_length=500)


@router.post("/operations/corporate")
async def operator_action(
    payload: ActionIn, operator=Depends(require_operator), session=Depends(get_session)
):
    item = await instrument(payload.symbol, payload.exchange)
    cutoff, payment = aware(payload.cutoffAt), aware(payload.payAt)
    if (
        cutoff <= datetime.now(UTC)
        or payment < cutoff
        or payment > cutoff + timedelta(days=370)
        or not verified_source_url(payload.sourceUrl)
    ):
        raise HTTPException(
            422, "미래 권리 기준일·지급일과 공식 공시 출처를 확인해 주세요."
        )
    if (
        payload.kind == "DIVIDEND"
        and (payload.perShare is None or payload.ratio is not None)
    ) or (
        payload.kind == "SPLIT"
        and (payload.ratio is None or payload.perShare is not None)
    ):
        raise HTTPException(422, "배당은 주당 금액, 분할은 비율만 입력해 주세요.")
    if payload.kind == "SPLIT" and payment != cutoff:
        raise HTTPException(422, "분할은 권리 적용 시점과 실행 시점이 같아야 해요.")
    from app.services.risk_engine import load_control

    await load_control(session, lock=True)
    duplicate = await session.scalar(
        sa.select(CorporateAction).where(
            CorporateAction.symbol == item.symbol,
            CorporateAction.exchange == item.exchange,
            CorporateAction.kind == payload.kind,
            CorporateAction.cutoff_at == cutoff,
            CorporateAction.pay_at == payment,
            CorporateAction.status == "VERIFIED",
        )
    )
    if duplicate and duplicate.source_key != payload.sourceKey:
        raise HTTPException(409, "같은 종목·권리 시각의 이벤트가 이미 등록됐어요.")
    previous = await session.scalar(
        sa.select(CorporateAction).where(
            CorporateAction.source_key == payload.sourceKey
        )
    )
    if previous:
        if (
            previous.symbol != item.symbol
            or previous.exchange != item.exchange
            or previous.kind != payload.kind
            or previous.per_share != payload.perShare
            or previous.ratio != payload.ratio
            or aware(previous.cutoff_at) != cutoff
            or aware(previous.pay_at) != payment
            or previous.source_url != payload.sourceUrl
        ):
            raise HTTPException(409, "같은 공시 식별자의 내용이 달라요.")
        return action_view(previous)
    row = CorporateAction(
        source_key=payload.sourceKey,
        symbol=item.symbol,
        exchange=item.exchange,
        market=item.market,
        currency=item.currency,
        kind=payload.kind,
        per_share=payload.perShare,
        ratio=payload.ratio,
        cutoff_at=cutoff,
        pay_at=payment,
        source_url=payload.sourceUrl,
        verified_by=operator.id,
    )
    session.add(row)
    await session.flush()
    return action_view(row)


@router.patch("/operations/corporate/{action_id}")
async def operator_cancel_action(
    action_id: UUID, operator=Depends(require_operator), session=Depends(get_session)
):
    row = await session.get(CorporateAction, action_id, with_for_update=True)
    if not row:
        raise HTTPException(404, "등록 일정이 없어요.")
    if aware(row.cutoff_at) <= datetime.now(UTC):
        raise HTTPException(
            409, "권리 기준 시각이 지난 일정은 취소할 수 없어요. 운영 점검이 필요해요."
        )
    row.status = "CANCELED"
    return action_view(row)
