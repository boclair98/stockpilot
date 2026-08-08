"""Watchlists, price alerts, portfolio insights, and learning missions."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.models import (
    PortfolioDailySnapshot,
    Position,
    PriceAlert,
    PushDevice,
    TradeOrder,
    TradingAccount,
    WatchlistItem,
)
from app.services.firebase_push import firebase_push
from app.services.instrument_catalog import Instrument, instrument_catalog
from app.services.kis_market import kis_market

router = APIRouter(prefix="/api/features", tags=["features"])

INITIAL_KRW = Decimal("100000000")
INITIAL_USD = Decimal("100000")
SEOUL = timezone(timedelta(hours=9))


class InstrumentIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=12)
    market: str = Field(pattern="^(KR|US)$")
    exchange: str = Field(min_length=3, max_length=8)


class AlertIn(InstrumentIn):
    direction: str = Field(pattern="^(ABOVE|BELOW)$")
    targetPrice: Decimal = Field(gt=0)


class PushDeviceIn(BaseModel):
    token: str = Field(min_length=20, max_length=4096)


def return_rate(equity: Decimal, initial: Decimal) -> Decimal:
    return (equity / initial - Decimal("1")) * Decimal("100")


def combined_return_rate(equity_krw: Decimal, equity_usd: Decimal) -> Decimal:
    return (
        (equity_krw / INITIAL_KRW + equity_usd / INITIAL_USD) / Decimal("2")
        - Decimal("1")
    ) * Decimal("100")


def alert_triggered(direction: str, current: Decimal, target: Decimal) -> bool:
    return (direction == "ABOVE" and current >= target) or (
        direction == "BELOW" and current <= target
    )


def mission_rows(
    filled_orders: int,
    limit_orders: int,
    position_count: int,
    watchlist_count: int,
    alert_count: int,
    league_joined: bool,
) -> list[dict]:
    return [
        {
            "key": "first-trade",
            "title": "첫 가상투자",
            "description": "첫 주문을 체결해 보세요",
            "progress": min(filled_orders, 1),
            "goal": 1,
        },
        {
            "key": "watchlist",
            "title": "관심종목 수집가",
            "description": "관심종목 3개를 모아보세요",
            "progress": min(watchlist_count, 3),
            "goal": 3,
        },
        {
            "key": "price-alert",
            "title": "가격 감시 시작",
            "description": "가격 알림을 만들어 보세요",
            "progress": min(alert_count, 1),
            "goal": 1,
        },
        {
            "key": "limit-order",
            "title": "계획적인 투자자",
            "description": "지정가·손절 주문을 사용해 보세요",
            "progress": min(limit_orders, 1),
            "goal": 1,
        },
        {
            "key": "diversified",
            "title": "분산투자 입문",
            "description": "서로 다른 종목 3개를 보유해 보세요",
            "progress": min(position_count, 3),
            "goal": 3,
        },
        {
            "key": "league",
            "title": "리그 데뷔",
            "description": "수익률 리그에 참여해 보세요",
            "progress": 1 if league_joined else 0,
            "goal": 1,
        },
    ]


async def _instrument(payload: InstrumentIn) -> Instrument:
    instrument = await instrument_catalog.get(
        payload.symbol.upper(),
        payload.market.upper(),
        payload.exchange.upper(),
    )
    if not instrument:
        raise HTTPException(404, "종목을 찾을 수 없습니다.")
    return instrument


async def _quote(instrument: Instrument) -> dict | None:
    cached = kis_market.quote(instrument.symbol, instrument.market, instrument.exchange)
    if cached:
        return cached
    await kis_market.watch(instrument)
    return None


async def _equity(
    session: AsyncSession, owner: UUID
) -> tuple[Decimal, Decimal, list[dict]]:
    wallet = await session.get(TradingAccount, owner)
    equity = {
        "KRW": Decimal(wallet.cash_krw) if wallet else INITIAL_KRW,
        "USD": Decimal(wallet.cash) if wallet else INITIAL_USD,
    }
    positions = (
        (
            await session.execute(
                sa.select(Position).where(
                    Position.owner_id == owner,
                    Position.quantity > 0,
                )
            )
        )
        .scalars()
        .all()
    )
    allocations = []
    for position in positions:
        instrument = await instrument_catalog.get(
            position.symbol, exchange=position.exchange
        )
        if not instrument:
            continue
        quote = await _quote(instrument)
        price = (
            Decimal(str(quote["price"]))
            if quote and quote.get("price") is not None
            else Decimal(position.average_price)
        )
        value = Decimal(position.quantity) * price
        equity[instrument.currency] += value
        allocations.append(
            {
                "symbol": position.symbol,
                "name": instrument.name,
                "market": instrument.market,
                "currency": instrument.currency,
                "value": float(value),
            }
        )
    return equity["KRW"], equity["USD"], allocations


async def _evaluate_alerts(session: AsyncSession, owner: UUID) -> list[PriceAlert]:
    alerts = (
        (
            await session.execute(
                sa.select(PriceAlert)
                .where(PriceAlert.owner_id == owner)
                .order_by(PriceAlert.created_at.desc())
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    for alert in alerts:
        if alert.status != "ACTIVE":
            continue
        instrument = await instrument_catalog.get(alert.symbol, exchange=alert.exchange)
        if not instrument:
            continue
        quote = await _quote(instrument)
        if quote and alert_triggered(
            alert.direction,
            Decimal(str(quote["price"])),
            Decimal(alert.target_price),
        ):
            alert.status = "TRIGGERED"
            alert.triggered_at = datetime.now(UTC)
    return alerts


@router.get("/dashboard")
async def dashboard(
    owner: UUID | None = Depends(optional_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not owner:
        return {
            "authenticated": False,
            "watchlist": [],
            "alerts": [],
            "unreadAlerts": 0,
            "push": {"configured": firebase_push.configured, "deviceCount": 0},
            "report": None,
            "missions": [],
        }

    watchlist = (
        (
            await session.execute(
                sa.select(WatchlistItem)
                .where(WatchlistItem.owner_id == owner)
                .order_by(WatchlistItem.created_at.desc())
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    watchlist_rows = []
    for item in watchlist:
        instrument = await instrument_catalog.get(item.symbol, exchange=item.exchange)
        if not instrument:
            continue
        quote = await _quote(instrument)
        watchlist_rows.append(
            {
                "id": str(item.id),
                "symbol": item.symbol,
                "name": instrument.name,
                "market": instrument.market,
                "currency": instrument.currency,
                "exchange": item.exchange,
                "price": quote.get("price") if quote else None,
                "changePercent": quote.get("changePercent") if quote else None,
            }
        )

    alerts = await _evaluate_alerts(session, owner)
    alert_rows = []
    for item in alerts:
        instrument = await instrument_catalog.get(item.symbol, exchange=item.exchange)
        if not instrument:
            continue
        quote = await _quote(instrument)
        alert_rows.append(
            {
                "id": str(item.id),
                "symbol": item.symbol,
                "name": instrument.name,
                "currency": instrument.currency,
                "direction": item.direction,
                "targetPrice": float(item.target_price),
                "currentPrice": quote.get("price") if quote else None,
                "status": item.status,
                "read": item.read_at is not None,
                "triggeredAt": (
                    item.triggered_at.isoformat() if item.triggered_at else None
                ),
            }
        )

    equity_krw, equity_usd, allocations = await _equity(session, owner)
    orders = (
        (
            await session.execute(
                sa.select(TradeOrder).where(TradeOrder.owner_id == owner)
            )
        )
        .scalars()
        .all()
    )
    filled = [order for order in orders if order.status == "FILLED"]
    realized_values = [
        Decimal(order.realized_pnl)
        for order in filled
        if order.realized_pnl is not None
    ]
    realized = {"KRW": Decimal("0"), "USD": Decimal("0")}
    total_costs = {"KRW": Decimal("0"), "USD": Decimal("0")}
    for order in filled:
        instrument = await instrument_catalog.get(order.symbol, exchange=order.exchange)
        if not instrument:
            continue
        currency = instrument.currency
        total_costs[currency] += Decimal(order.fee) + Decimal(order.tax)
        if order.realized_pnl is not None:
            realized[currency] += Decimal(order.realized_pnl)
    combined = combined_return_rate(equity_krw, equity_usd)
    today = datetime.now(SEOUL).date()
    snapshot = await session.scalar(
        sa.select(PortfolioDailySnapshot).where(
            PortfolioDailySnapshot.owner_id == owner,
            PortfolioDailySnapshot.snapshot_date == today,
        )
    )
    if snapshot:
        snapshot.equity_krw = equity_krw
        snapshot.equity_usd = equity_usd
        snapshot.return_rate = combined
    else:
        session.add(
            PortfolioDailySnapshot(
                owner_id=owner,
                snapshot_date=today,
                equity_krw=equity_krw,
                equity_usd=equity_usd,
                return_rate=combined,
            )
        )
    history = (
        (
            await session.execute(
                sa.select(PortfolioDailySnapshot)
                .where(PortfolioDailySnapshot.owner_id == owner)
                .order_by(PortfolioDailySnapshot.snapshot_date.desc())
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    history.reverse()

    from app.models import LeagueParticipant

    league_joined = bool(
        await session.scalar(
            sa.select(LeagueParticipant.id).where(
                LeagueParticipant.owner_id == owner,
                LeagueParticipant.active.is_(True),
            )
        )
    )
    active_positions = sum(1 for item in allocations if item["value"] > 0)
    missions = mission_rows(
        len(filled),
        sum(
            1 for order in orders if order.order_type in {"LIMIT", "STOP", "STOP_LIMIT"}
        ),
        active_positions,
        len(watchlist_rows),
        len(alert_rows),
        league_joined,
    )

    return {
        "authenticated": True,
        "watchlist": watchlist_rows,
        "alerts": alert_rows,
        "unreadAlerts": sum(
            1 for item in alerts if item.status == "TRIGGERED" and item.read_at is None
        ),
        "push": {
            "configured": firebase_push.configured,
            "deviceCount": int(
                await session.scalar(
                    sa.select(sa.func.count()).where(
                        PushDevice.owner_id == owner,
                        PushDevice.enabled.is_(True),
                    )
                )
                or 0
            ),
        },
        "report": {
            "equity": {"KRW": float(equity_krw), "USD": float(equity_usd)},
            "returnRate": {
                "KRW": float(return_rate(equity_krw, INITIAL_KRW)),
                "USD": float(return_rate(equity_usd, INITIAL_USD)),
                "combined": float(combined),
            },
            "tradeCount": len(filled),
            "realizedPnl": {
                "KRW": float(realized["KRW"]),
                "USD": float(realized["USD"]),
            },
            "winRate": (
                sum(1 for value in realized_values if value > 0)
                / len(realized_values)
                * 100
                if realized_values
                else 0
            ),
            "totalCosts": {
                "KRW": float(total_costs["KRW"]),
                "USD": float(total_costs["USD"]),
            },
            "allocations": allocations,
            "history": [
                {
                    "date": row.snapshot_date.isoformat(),
                    "returnRate": float(row.return_rate),
                }
                for row in history
            ],
        },
        "missions": [
            {
                **mission,
                "completed": mission["progress"] >= mission["goal"],
            }
            for mission in missions
        ],
    }


@router.get("/news")
async def news(
    symbol: str = Query(min_length=1, max_length=12),
    market: str = Query(pattern="^(KR|US)$"),
    exchange: str = Query(min_length=3, max_length=8),
) -> dict:
    instrument = await instrument_catalog.get(
        symbol.upper(), market.upper(), exchange.upper()
    )
    if not instrument:
        raise HTTPException(404, "종목을 찾을 수 없습니다.")
    return {
        "symbol": instrument.symbol,
        "name": instrument.name,
        "source": "한국투자증권 KIS Open API",
        "refreshedAt": datetime.now(UTC).isoformat(),
        "items": await kis_market.news_titles(instrument),
    }


@router.get("/history")
async def history(
    symbol: str = Query(min_length=1, max_length=12),
    market: str = Query(pattern="^(KR|US)$"),
    exchange: str = Query(min_length=3, max_length=8),
) -> dict:
    instrument = await instrument_catalog.get(
        symbol.upper(), market.upper(), exchange.upper()
    )
    if not instrument:
        raise HTTPException(404, "종목을 찾을 수 없습니다.")
    return {
        "symbol": instrument.symbol,
        "name": instrument.name,
        "market": instrument.market,
        "currency": instrument.currency,
        "exchange": instrument.exchange,
        "source": "한국투자증권 KIS Open API",
        "items": await kis_market.daily_history(instrument),
    }


@router.post("/watchlist", status_code=201)
async def add_watchlist(
    payload: InstrumentIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    instrument = await _instrument(payload)
    existing = await session.scalar(
        sa.select(WatchlistItem).where(
            WatchlistItem.owner_id == owner,
            WatchlistItem.symbol == instrument.symbol,
            WatchlistItem.exchange == instrument.exchange,
        )
    )
    if existing:
        return {"id": str(existing.id), "added": False}
    count = await session.scalar(
        sa.select(sa.func.count()).where(WatchlistItem.owner_id == owner)
    )
    if (count or 0) >= 20:
        raise HTTPException(409, "관심종목은 최대 20개까지 저장할 수 있습니다.")
    row = WatchlistItem(
        owner_id=owner,
        symbol=instrument.symbol,
        exchange=instrument.exchange,
    )
    session.add(row)
    await session.flush()
    await kis_market.watch(instrument)
    return {"id": str(row.id), "added": True}


@router.delete("/watchlist/{item_id}")
async def remove_watchlist(
    item_id: UUID,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await session.scalar(
        sa.select(WatchlistItem).where(
            WatchlistItem.id == item_id,
            WatchlistItem.owner_id == owner,
        )
    )
    if not row:
        raise HTTPException(404, "관심종목을 찾을 수 없습니다.")
    await session.delete(row)
    return {"removed": True}


@router.post("/alerts", status_code=201)
async def create_alert(
    payload: AlertIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    instrument = await _instrument(payload)
    count = await session.scalar(
        sa.select(sa.func.count()).where(
            PriceAlert.owner_id == owner,
            PriceAlert.status == "ACTIVE",
        )
    )
    if (count or 0) >= 20:
        raise HTTPException(409, "활성 가격 알림은 최대 20개까지 만들 수 있습니다.")
    row = PriceAlert(
        owner_id=owner,
        symbol=instrument.symbol,
        exchange=instrument.exchange,
        direction=payload.direction,
        target_price=payload.targetPrice,
    )
    session.add(row)
    await session.flush()
    await kis_market.watch(instrument)
    return {"id": str(row.id), "status": row.status}


@router.post("/alerts/read")
async def read_alerts(
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        sa.update(PriceAlert)
        .where(
            PriceAlert.owner_id == owner,
            PriceAlert.status == "TRIGGERED",
            PriceAlert.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    return {"read": result.rowcount or 0}


@router.delete("/alerts/{alert_id}")
async def delete_alert(
    alert_id: UUID,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await session.scalar(
        sa.select(PriceAlert).where(
            PriceAlert.id == alert_id,
            PriceAlert.owner_id == owner,
        )
    )
    if not row:
        raise HTTPException(404, "가격 알림을 찾을 수 없습니다.")
    await session.delete(row)
    return {"removed": True}


@router.post("/push/devices")
async def register_push_device(
    payload: PushDeviceIn,
    request: Request,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not firebase_push.configured:
        raise HTTPException(503, "푸시 알림 설정을 준비하고 있습니다.")
    now = datetime.now(UTC)
    row = await session.scalar(
        sa.select(PushDevice).where(PushDevice.token == payload.token)
    )
    if row:
        row.owner_id = owner
        row.enabled = True
        row.last_seen_at = now
        row.user_agent = (request.headers.get("user-agent") or "")[:255] or None
        return {"registered": True}

    device_count = await session.scalar(
        sa.select(sa.func.count()).where(
            PushDevice.owner_id == owner,
            PushDevice.enabled.is_(True),
        )
    )
    if (device_count or 0) >= 10:
        raise HTTPException(409, "푸시 알림 기기는 최대 10개까지 등록할 수 있습니다.")
    session.add(
        PushDevice(
            owner_id=owner,
            token=payload.token,
            user_agent=(request.headers.get("user-agent") or "")[:255] or None,
            last_seen_at=now,
        )
    )
    return {"registered": True}


@router.post("/push/devices/remove")
async def remove_push_device(
    payload: PushDeviceIn,
    owner: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        sa.delete(PushDevice).where(
            PushDevice.owner_id == owner,
            PushDevice.token == payload.token,
        )
    )
    return {"removed": bool(result.rowcount)}
