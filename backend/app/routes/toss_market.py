"""App-specific public market data only; no account or personal data."""

import asyncio
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response

from app.services.instrument_catalog import instrument_catalog
from app.services.market_rankings import ranking_snapshot

router = APIRouter(prefix="/api/toss-market", tags=["toss-market"])


@router.get("/rankings")
async def rankings(
    response: Response,
    market: Literal["KR", "US"] = "KR",
    metric: Literal["CAP", "VOLUME", "UP", "DOWN"] = "CAP",
    exchange: Literal["ALL", "KOSPI", "KOSDAQ", "NAS", "NYS", "AMS"] = "ALL",
    offset: int = Query(default=0, ge=0, le=600),
    limit: int = Query(default=20, ge=1, le=100),
    requested_snapshot: str | None = Query(
        default=None, max_length=64, alias="snapshot"
    ),
) -> dict:
    if (market == "KR" and exchange not in {"ALL", "KOSPI", "KOSDAQ"}) or (
        market == "US" and exchange not in {"ALL", "NAS", "NYS", "AMS"}
    ):
        raise HTTPException(422, "시장과 거래소 선택을 확인해 주세요.")
    try:
        snapshot = await asyncio.wait_for(
            ranking_snapshot(market, metric, exchange), timeout=15
        )
    except TimeoutError:
        raise HTTPException(
            503,
            "순위 조회가 지연돼요. 잠시 후 다시 시도해 주세요.",
            headers={"Retry-After": "120"},
        ) from None
    if snapshot["partial"] and not snapshot["items"]:
        raise HTTPException(
            503,
            "실제 시장 순위를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
            headers={"Retry-After": "120"},
        )
    if requested_snapshot is not None and requested_snapshot != snapshot["asOf"]:
        raise HTTPException(409, "순위가 갱신됐어요. 새로고침한 뒤 다시 살펴보세요.")
    items = snapshot.pop("items")
    response.headers["Cache-Control"] = "public, max-age=30, s-maxage=60"
    return {
        **snapshot,
        "items": items[offset : offset + limit],
        "total": len(items),
        "offset": offset,
        "hasMore": offset + limit < len(items),
        "nextOffset": offset + limit if offset + limit < len(items) else None,
    }


@router.get("/instruments")
async def instruments(
    response: Response,
    market: Literal["KR", "US"] = "KR",
    exchange: Literal["ALL", "KOSPI", "KOSDAQ", "NAS", "NYS", "AMS"] = "ALL",
    offset: int = Query(default=0, ge=0, le=50000),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    if (market == "KR" and exchange not in {"ALL", "KOSPI", "KOSDAQ"}) or (
        market == "US" and exchange not in {"ALL", "NAS", "NYS", "AMS"}
    ):
        raise HTTPException(422, "시장과 거래소 선택을 확인해 주세요.")
    try:
        result = await asyncio.wait_for(
            instrument_catalog.page(market, exchange, offset, limit), timeout=12
        )
    except TimeoutError:
        raise HTTPException(
            503, "종목 목록이 지연돼요. 잠시 후 다시 시도해 주세요."
        ) from None
    response.headers["Cache-Control"] = "public, max-age=60, s-maxage=300"
    return {
        **result,
        "offset": offset,
        "market": market,
        "exchange": exchange,
        "metric": "ALL",
        "asOf": datetime.now(UTC).isoformat(),
        "scope": "공식 종목 목록 · 가격은 상세에서 조회",
        "stale": False,
        "providerHasMore": False,
        "refreshSeconds": 300,
        "source": "KIS 종목 마스터",
    }
