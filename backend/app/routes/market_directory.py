"""Public, read-only web instrument directory. No trading/account writes."""

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response

from app.services.instrument_catalog import instrument_catalog

router = APIRouter(prefix="/api/market", tags=["market-directory"])


@router.get("/instruments")
async def instruments(
    response: Response,
    market: Literal["KR", "US"] = "KR",
    exchange: Literal["ALL", "KOSPI", "KOSDAQ", "NAS", "NYS", "AMS"] = "ALL",
    q: str = Query(default="", max_length=80),
    offset: int = Query(default=0, ge=0, le=50000),
    limit: int = Query(default=20, ge=20, le=100),
    snapshot: str | None = Query(default=None, max_length=64),
) -> dict:
    allowed = (
        {"ALL", "KOSPI", "KOSDAQ"} if market == "KR" else {"ALL", "NAS", "NYS", "AMS"}
    )
    if exchange not in allowed or limit not in {20, 50, 100}:
        raise HTTPException(422, "시장과 거래소 선택을 확인해 주세요.")
    try:
        page = await asyncio.wait_for(
            instrument_catalog.directory(market, exchange, q, offset, limit), timeout=15
        )
    except TimeoutError as exc:
        raise HTTPException(
            503,
            "종목 목록을 준비하고 있어요. 잠시 후 다시 조회해 주세요.",
            headers={"Retry-After": "10"},
        ) from exc
    if page["partial"] and not page["items"]:
        raise HTTPException(
            503,
            "거래소 종목 목록을 받지 못했어요. 잠시 후 다시 조회해 주세요.",
            headers={"Retry-After": "30"},
        )
    if snapshot and page["snapshot"] != snapshot:
        raise HTTPException(
            409, "종목 목록이 갱신됐어요. 첫 페이지부터 다시 조회해 주세요."
        )
    # Never cache queries at the shared CDN or expose personal account data.
    response.headers["Cache-Control"] = (
        "no-store"
        if q.strip() or page["partial"]
        else "public, max-age=30, s-maxage=60"
    )
    return page
