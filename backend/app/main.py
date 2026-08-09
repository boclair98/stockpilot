import asyncio
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.identity import SESSION_COOKIE, decode_session
from app.core.traffic import request_metrics, traffic_store
from app.routes.auth import router as auth_router
from app.routes.company import router as company_router
from app.routes.engagement import router as engagement_router
from app.routes.growth import router as growth_router
from app.routes.league import router as league_router
from app.routes.posts import router as posts_router
from app.routes.trading import router as trading_router
from app.routes.users import router as users_router
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market
from app.services.price_alert_notifier import price_alert_notifier


@asynccontextmanager
async def lifespan(app: FastAPI):
    await traffic_store.start()
    kis_market.start()
    price_alert_notifier.start()
    async def warm_instrument_catalog() -> None:
        # Give the above-the-fold bootstrap priority, then prepare first search.
        await asyncio.sleep(3)
        await instrument_catalog.ensure_loaded()

    catalog_task = asyncio.create_task(
        warm_instrument_catalog(), name="instrument-catalog-warmup"
    )
    try:
        yield
    finally:
        catalog_task.cancel()
        await asyncio.gather(catalog_task, return_exceptions=True)
        await price_alert_notifier.stop()
        await kis_market.stop()
        await traffic_store.close()
        await engine.dispose()


app = FastAPI(
    title="StockPilot API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)


def _traffic_identity(request: Request) -> str:
    session_cookie = request.cookies.get(SESSION_COOKIE)
    identity = decode_session(session_cookie)
    if identity:
        return f"session:{identity.id}"
    forwarded = request.headers.get("cf-connecting-ip")
    client = forwarded or (request.client.host if request.client else "unknown")
    return f"ip:{client}"


@app.middleware("http")
async def traffic_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id", "")
    if not request_id.isascii() or not 8 <= len(request_id) <= 64:
        request_id = str(uuid4())
    started = time.perf_counter()
    status = 500
    await request_metrics.begin()
    try:
        if request.url.path.startswith("/api/") and not request.url.path.startswith(
            "/api/health"
        ):
            is_write = request.method not in {"GET", "HEAD", "OPTIONS"}
            limit = (
                settings.rate_limit_write_per_minute
                if is_write
                else settings.rate_limit_read_per_minute
            )
            bucket = int(time.time() // 60)
            allowed = await traffic_store.allow(
                f"ratelimit:{_traffic_identity(request)}:{'w' if is_write else 'r'}:{bucket}",
                limit,
            )
            if not allowed:
                status = 429
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.",
                        "requestId": request_id,
                    },
                    headers={"Retry-After": "60", "X-Request-ID": request_id},
                )
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time"] = (
            f"{(time.perf_counter() - started) * 1000:.1f}ms"
        )
        return response
    finally:
        await request_metrics.finish(status, (time.perf_counter() - started) * 1000)


app.include_router(users_router)
app.include_router(auth_router)
app.include_router(company_router)
app.include_router(engagement_router)
app.include_router(growth_router)
app.include_router(league_router)
app.include_router(posts_router)
app.include_router(trading_router)


@app.get("/api/health")
async def health() -> JSONResponse:
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503, content={"status": "error", "detail": "database"}
        )
    return JSONResponse(content={"status": "ok"})


@app.get("/api/health/live")
async def liveness() -> JSONResponse:
    """Liveness probe — answers the instant this process can serve a request,
    touching NOTHING (no DB, no I/O). The frontend's warming banner
    (frontend/lib/warming.ts) hits this to tell a real cold start apart from a
    merely slow request: when the api KSvc is scaled to zero, Knative's
    activator buffers this until a pod is up, so the probe is slow ⇔ the server
    is genuinely waking. When warm it returns in ~1ms even while a heavy
    endpoint is still in flight — so the banner stays off for ordinary slowness.
    Keep it dependency-free; adding a DB hit here would reintroduce false
    'warming' whenever the DB (not the pod) is the slow part."""
    return JSONResponse(content={"status": "ok"})


@app.get("/api/health/traffic")
async def traffic_health() -> JSONResponse:
    """Aggregated process health for dashboards; contains no user data."""

    return JSONResponse(
        content={"status": "ok", **(await request_metrics.snapshot())},
        headers={"Cache-Control": "no-store"},
    )
