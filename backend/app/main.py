from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.routes.auth import router as auth_router
from app.routes.league import router as league_router
from app.routes.posts import router as posts_router
from app.routes.trading import router as trading_router
from app.routes.users import router as users_router
from app.services.kis_market import kis_market


@asynccontextmanager
async def lifespan(app: FastAPI):
    kis_market.start()
    try:
        yield
    finally:
        await kis_market.stop()


app = FastAPI(
    title="StockPilot API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.include_router(users_router)
app.include_router(auth_router)
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
