"""Dedicated process for StockPilot's long-lived market workers.

The public API process remains focused on short request/response work. This
service owns the KIS WebSocket collector and the simulated alert/protection
pollers, while Redis leases prevent duplicate work if the platform starts
more than one worker replica.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.traffic import traffic_store
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market
from app.services.price_alert_notifier import price_alert_notifier
from app.services.protection_matcher import protection_matcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    await traffic_store.start()
    kis_market.start()
    price_alert_notifier.start()
    protection_matcher.start()

    async def warm_instrument_catalog() -> None:
        # The worker already owns the market connection, so prepare the full
        # searchable catalog without delaying process readiness.
        await asyncio.sleep(1)
        await instrument_catalog.ensure_loaded()

    catalog_task = asyncio.create_task(
        warm_instrument_catalog(), name="worker-instrument-catalog-warmup"
    )
    try:
        yield
    finally:
        catalog_task.cancel()
        await asyncio.gather(catalog_task, return_exceptions=True)
        await price_alert_notifier.stop()
        await protection_matcher.stop()
        await kis_market.stop()
        await traffic_store.close()
        await engine.dispose()


app = FastAPI(title="StockPilot Worker", version="1.0.0", lifespan=lifespan)


@app.get("/health/live")
async def liveness() -> JSONResponse:
    return JSONResponse(content={"status": "ok", "service": "worker"})


@app.get("/health/ready")
async def readiness() -> JSONResponse:
    database_ready = True
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        database_ready = False
    redis_ready = traffic_store.available if settings.redis_url else True
    ready = database_ready and redis_ready
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ready" if ready else "not-ready",
            "components": {
                "database": "ok" if database_ready else "error",
                "sharedCache": "ok" if redis_ready else "error",
                "marketData": kis_market.status(),
            },
        },
        headers={"Cache-Control": "no-store"},
    )
