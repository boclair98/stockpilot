"""Apps-in-Toss-only fictional market. No broker quote or web ledger is read here."""

from __future__ import annotations

import hashlib
import math
import re
import time
import uuid
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.identity import require_identity
from app.core.traffic import traffic_store
from app.models import TossGameAccount, TossGameOrder, TossGamePosition
from app.services.instrument_catalog import TOP_INSTRUMENTS

router = APIRouter(prefix="/api/toss-game", tags=["toss-fictional-game"])
INSTRUMENTS = {item.symbol: item for item in TOP_INSTRUMENTS}
START_KRW = Decimal("100000000")
START_USD = Decimal("100000")
COMMISSION = Decimal("0.00015")
KR_SELL_TAX = Decimal("0.002")
TICK_SECONDS = 30
RANK_CACHE = "toss-game:rankings:v1"
NICKNAME = re.compile(r"^[가-힣A-Za-z0-9_]{2,12}$")


def tick(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // TICK_SECONDS)


def fictional_price(symbol: str, bucket: int) -> Decimal:
    """Stable, shared 30-second game price; deliberately unrelated to exchanges."""
    item = INSTRUMENTS[symbol]
    seed = int.from_bytes(hashlib.blake2s(symbol.encode(), digest_size=4).digest(), "big")
    base = Decimal(3000 + seed % 97000) if item.market == "KR" else Decimal(20 + seed % 480)
    phase = seed % 1000 / 73
    factor = 1 + 0.027 * math.sin(bucket / 31 + phase) + 0.013 * math.sin(bucket / 11 + phase / 3)
    digits = Decimal("1") if item.market == "KR" else Decimal("0.01")
    return (base * Decimal(str(factor))).quantize(digits, rounding=ROUND_HALF_UP)


def quote(item, bucket: int) -> dict:
    price = fictional_price(item.symbol, bucket)
    previous = fictional_price(item.symbol, bucket - 1)
    return {
        "symbol": item.symbol,
        "name": item.name,
        "englishName": item.english_name,
        "market": item.market,
        "currency": item.currency,
        "exchange": item.exchange,
        "price": float(price),
        "change": float(price - previous),
        "changePercent": round(float((price / previous - 1) * 100), 2),
        "asOf": datetime.fromtimestamp(bucket * TICK_SECONDS, UTC).isoformat(),
        "isFictional": True,
    }


def game_index(bucket: int) -> dict:
    korean = [item for item in TOP_INSTRUMENTS if item.market == "KR"]
    def value(at: int) -> float:
        return round(sum(float(fictional_price(item.symbol, at)) / float(fictional_price(item.symbol, 0)) for item in korean) * 100, 2)
    current, previous = value(bucket), value(bucket - 1)
    return {
        "name": "가상시장 지수", "value": current, "change": round(current - previous, 2),
        "changePercent": round((current / previous - 1) * 100, 2),
        "points": [{"date": datetime.fromtimestamp((bucket - step) * TICK_SECONDS, UTC).isoformat(), "close": value(bucket - step)} for step in range(20, -1, -1)],
        "asOf": datetime.fromtimestamp(bucket * TICK_SECONDS, UTC).isoformat(),
    }


async def game_account(session: AsyncSession, owner: UUID, *, lock: bool = False) -> TossGameAccount:
    await session.execute(
        pg_insert(TossGameAccount).values(owner_id=owner, cash_krw=START_KRW, cash_usd=START_USD)
        .on_conflict_do_nothing(index_elements=[TossGameAccount.owner_id])
    )
    query = sa.select(TossGameAccount).where(TossGameAccount.owner_id == owner)
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one()


@router.get("/bootstrap")
async def bootstrap(response: Response) -> dict:
    bucket = tick()
    response.headers["Cache-Control"] = "public, max-age=10, s-maxage=10"
    return {"quotes": [quote(item, bucket) for item in TOP_INSTRUMENTS], "kospi": game_index(bucket),
            "asOf": datetime.fromtimestamp(bucket * TICK_SECONDS, UTC).isoformat(), "mode": "FICTIONAL"}


@router.get("/search")
async def search(response: Response, q: str = Query(min_length=1, max_length=60), market: str = Query(default="ALL", pattern="^(ALL|KR|US)$"), limit: int = Query(default=20, ge=1, le=30)) -> dict:
    response.headers["Cache-Control"] = "public, max-age=10"
    needle = q.strip().casefold()
    matches = [item for item in TOP_INSTRUMENTS if (market == "ALL" or item.market == market) and (needle in item.name.casefold() or needle in item.symbol.casefold() or needle in item.english_name.casefold())]
    return {"items": [quote(item, tick()) for item in matches[:limit]], "total": len(matches)}


@router.get("/quote")
async def get_quote(symbol: str, market: str, exchange: str) -> dict:
    item = INSTRUMENTS.get(symbol.upper())
    if not item or item.market != market or item.exchange != exchange:
        raise HTTPException(404, "가상시장 종목을 찾을 수 없습니다.")
    return quote(item, tick())


@router.get("/history")
async def history(symbol: str, market: str, exchange: str) -> dict:
    item = INSTRUMENTS.get(symbol.upper())
    if not item or item.market != market or item.exchange != exchange:
        raise HTTPException(404, "가상시장 종목을 찾을 수 없습니다.")
    current = tick()
    return {"items": [{"date": datetime.fromtimestamp(bucket * TICK_SECONDS, UTC).isoformat(), "close": float(fictional_price(symbol, bucket))} for bucket in range(current - 65, current + 1)]}


@router.get("/rules")
async def rules() -> dict:
    return {"fees": {"commissionRate": float(COMMISSION * 100), "krSellTaxRate": float(KR_SELL_TAX * 100), "slippage": "30초마다 바뀌는 가상 가격으로 서버에서 체결"}, "mode": "FICTIONAL"}


@router.get("/portfolio")
async def portfolio(owner: UUID = Depends(require_identity), session: AsyncSession = Depends(get_session)) -> dict:
    account = await game_account(session, owner)
    positions = (await session.execute(sa.select(TossGamePosition).where(TossGamePosition.owner_id == owner))).scalars().all()
    orders = (await session.execute(sa.select(TossGameOrder).where(TossGameOrder.owner_id == owner).order_by(TossGameOrder.created_at.desc()).limit(30))).scalars().all()
    bucket = tick()
    holdings = []
    for position in positions:
        item = INSTRUMENTS.get(position.symbol)
        if not item:
            continue
        price = fictional_price(item.symbol, bucket)
        average = Decimal(position.average_price)
        holdings.append({"symbol": item.symbol, "name": item.name, "market": item.market, "currency": item.currency, "exchange": item.exchange,
                         "quantity": position.quantity, "averagePrice": float(average), "currentPrice": float(price),
                         "marketValue": float(price * position.quantity), "profit": float((price - average) * position.quantity),
                         "returnRate": round(float((price / average - 1) * 100), 2)})
    return {"authenticated": True, "cash": {"KRW": float(account.cash_krw), "USD": float(account.cash_usd)}, "positions": holdings,
            "orders": [{"id": str(row.id), "symbol": row.symbol, "exchange": INSTRUMENTS[row.symbol].exchange, "side": row.side,
                        "orderType": "MARKET", "quantity": row.quantity, "fillPrice": float(row.fill_price), "status": "FILLED",
                        "createdAt": row.created_at.isoformat()} for row in orders]}


class GameOrderIn(BaseModel):
    symbol: str
    market: str
    exchange: str
    side: str
    quantity: int = Field(gt=0, le=10000)


@router.post("/orders")
async def order(payload: GameOrderIn, idempotency_key: str = Header(min_length=8, max_length=80), owner: UUID = Depends(require_identity), session: AsyncSession = Depends(get_session)) -> dict:
    item = INSTRUMENTS.get(payload.symbol.upper())
    if not item or item.market != payload.market or item.exchange != payload.exchange:
        raise HTTPException(404, "가상시장 종목을 찾을 수 없습니다.")
    if payload.side not in {"BUY", "SELL"}:
        raise HTTPException(422, "매수 또는 매도만 선택할 수 있습니다.")
    account = await game_account(session, owner, lock=True)
    prior = await session.scalar(sa.select(TossGameOrder).where(TossGameOrder.owner_id == owner, TossGameOrder.request_key == idempotency_key))
    if prior:
        if (prior.symbol, prior.side, prior.quantity) != (item.symbol, payload.side, payload.quantity):
            raise HTTPException(409, "이미 다른 주문에 사용된 요청 번호입니다.")
        return {"id": str(prior.id), "status": "FILLED", "fillPrice": float(prior.fill_price), "replayed": True}
    position = await session.scalar(sa.select(TossGamePosition).where(TossGamePosition.owner_id == owner, TossGamePosition.symbol == item.symbol).with_for_update())
    price = fictional_price(item.symbol, tick())
    notional = price * payload.quantity
    fee = (notional * COMMISSION).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    field = "cash_krw" if item.market == "KR" else "cash_usd"
    cash = Decimal(getattr(account, field))
    if payload.side == "BUY":
        if cash < notional + fee:
            raise HTTPException(409, "가상 주문 가능 금액이 부족해요.")
        setattr(account, field, cash - notional - fee)
        if position:
            old_cost = Decimal(position.average_price) * position.quantity
            position.quantity += payload.quantity
            position.average_price = (old_cost + notional + fee) / position.quantity
        else:
            session.add(TossGamePosition(owner_id=owner, symbol=item.symbol, quantity=payload.quantity, average_price=(notional + fee) / payload.quantity))
    else:
        if not position or position.quantity < payload.quantity:
            raise HTTPException(409, "보유하지 않은 종목이나 보유 수량을 넘겨 매도할 수 없어요.")
        tax = (notional * KR_SELL_TAX).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if item.market == "KR" else Decimal("0")
        setattr(account, field, cash + notional - fee - tax)
        position.quantity -= payload.quantity
        if position.quantity == 0:
            await session.delete(position)
    receipt = TossGameOrder(id=uuid.uuid4(), owner_id=owner, request_key=idempotency_key, symbol=item.symbol, side=payload.side, quantity=payload.quantity, fill_price=price)
    session.add(receipt)
    await session.flush()
    await traffic_store.delete(RANK_CACHE)
    return {"id": str(receipt.id), "status": "FILLED", "fillPrice": float(price)}


def account_return(account: TossGameAccount, positions: list[TossGamePosition], prices: dict[str, Decimal]) -> float:
    krw = Decimal(account.cash_krw)
    usd = Decimal(account.cash_usd)
    for position in positions:
        item = INSTRUMENTS.get(position.symbol)
        if item:
            value = prices[item.symbol] * position.quantity
            if item.market == "KR":
                krw += value
            else:
                usd += value
    return round(float(((krw / START_KRW - 1) + (usd / START_USD - 1)) * 50), 2)


@router.get("/rankings")
async def rankings(owner: UUID = Depends(require_identity), session: AsyncSession = Depends(get_session)) -> dict:
    account = await game_account(session, owner)
    async def calculate() -> list[dict]:
        accounts = (await session.execute(sa.select(TossGameAccount).where(TossGameAccount.joined_at.is_not(None)))).scalars().all()
        if not accounts:
            return []
        positions = (await session.execute(sa.select(TossGamePosition).where(TossGamePosition.owner_id.in_([row.owner_id for row in accounts])))).scalars().all()
        by_owner: dict[UUID, list[TossGamePosition]] = {}
        for position in positions:
            by_owner.setdefault(position.owner_id, []).append(position)
        bucket = tick()
        prices = {symbol: fictional_price(symbol, bucket) for symbol in INSTRUMENTS}
        rows = [{"owner": str(row.owner_id), "nickname": row.nickname, "returnRate": account_return(row, by_owner.get(row.owner_id, []), prices)} for row in accounts]
        rows.sort(key=lambda row: (-row["returnRate"], row["owner"]))
        return rows
    rows = await traffic_store.get_or_set(RANK_CACHE, 20, calculate)
    my_rank = next((index + 1 for index, row in enumerate(rows) if row["owner"] == str(owner)), None)
    return {"title": "가상 시세 수익률 리그", "participantCount": len(rows),
            "rankings": [{"rank": index + 1, "nickname": row["nickname"], "returnRate": row["returnRate"], "rankChange": 0, "isMe": row["owner"] == str(owner)} for index, row in enumerate(rows[:50])],
            "me": {"joined": account.joined_at is not None, "nickname": account.nickname, "rank": my_rank,
                   "returnRate": rows[my_rank - 1]["returnRate"] if my_rank else None}}


class JoinIn(BaseModel):
    nickname: str | None = None


@router.post("/join")
async def join(payload: JoinIn, owner: UUID = Depends(require_identity), session: AsyncSession = Depends(get_session)) -> dict:
    account = await game_account(session, owner, lock=True)
    nickname = (payload.nickname or f"파일럿{str(owner)[:6]}").strip()
    if not NICKNAME.fullmatch(nickname):
        raise HTTPException(422, "닉네임은 한글·영문·숫자·밑줄 2~12자로 입력해 주세요.")
    taken = await session.scalar(sa.select(TossGameAccount.owner_id).where(TossGameAccount.nickname == nickname, TossGameAccount.owner_id != owner))
    if taken:
        raise HTTPException(409, "이미 사용 중인 닉네임이에요.")
    account.nickname = nickname
    account.joined_at = datetime.now(UTC)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(409, "이미 사용 중인 닉네임이에요.") from exc
    await traffic_store.delete(RANK_CACHE)
    return {"joined": True, "nickname": nickname}


@router.delete("/me")
async def delete_game(owner: UUID = Depends(require_identity), session: AsyncSession = Depends(get_session)) -> dict:
    await session.execute(sa.delete(TossGameOrder).where(TossGameOrder.owner_id == owner))
    await session.execute(sa.delete(TossGamePosition).where(TossGamePosition.owner_id == owner))
    await session.execute(sa.delete(TossGameAccount).where(TossGameAccount.owner_id == owner))
    await traffic_store.delete(RANK_CACHE)
    return {"status": "deleted"}
