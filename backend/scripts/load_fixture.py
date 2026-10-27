"""Opt-in loopback-only synthetic SEC read benchmark; no DB or real APIs."""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

if os.getenv("STOCKPILOT_LOAD_FIXTURE") != "1":
    raise SystemExit("Set STOCKPILOT_LOAD_FIXTURE=1. Never deploy this script.")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import uvicorn  # noqa: E402
from app.core import config  # noqa: E402

# Discard inherited/.env settings before importing any service. Constructed
# defaults contain no real DB, KIS, SEC, auth or Firebase credentials.
config.settings = config.Settings.model_construct(
    redis_url=None,
    run_background_workers=False,
    sec_user_agent="StockPilot-fixture contact@example.com",
)

from app.core.traffic import TrafficStore  # noqa: E402
from app.routes import company  # noqa: E402
from app.services.sec_company import SecCompanyService  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

COUNTS = {"requests": 0, "directory": 0, "submissions": 0}
ISSUERS = {"AAPL": 320193, "MSFT": 789019, "BRK-B": 1067983}


def upstream(request: httpx.Request) -> httpx.Response:
    # Every service request uses MockTransport, including any unexpected URL.
    COUNTS["requests"] += 1
    if request.url.path == "/files/company_tickers.json":
        COUNTS["directory"] += 1
        return httpx.Response(
            200,
            json={
                str(i): {
                    "ticker": symbol,
                    "cik_str": cik,
                    "title": f"격리 시험 {symbol}",
                }
                for i, (symbol, cik) in enumerate(ISSUERS.items())
            },
        )
    for symbol, cik in ISSUERS.items():
        if request.url.path == f"/submissions/CIK{cik:010d}.json":
            COUNTS["submissions"] += 1
            return httpx.Response(
                200,
                json={
                    "cik": str(cik),
                    "name": f"격리 시험 {symbol}",
                    "filings": {
                        "recent": {
                            "form": ["10-K"],
                            "filingDate": ["2026-10-01"],
                            "accessionNumber": [f"{cik:010d}-26-000001"],
                            "primaryDocument": ["fixture.htm"],
                            "primaryDocDescription": [
                                "Synthetic load fixture, not market data"
                            ],
                        }
                    },
                },
            )
    raise RuntimeError("Unexpected upstream URL; real outbound network is disabled")


service = SecCompanyService(
    store=TrafficStore(), transport=httpx.MockTransport(upstream)
)
company.sec_company = service


@asynccontextmanager
async def lifespan(app):
    for symbol in ISSUERS:
        await service.company(symbol)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def fixture_only(request: Request, call_next):
    if request.method != "GET" or not (
        request.url.path
        in {"/__loadtest__/manifest", "/__loadtest__/stats", "/api/company/us-lookup"}
        or request.url.path.startswith("/api/company/us/")
    ):
        return JSONResponse(
            {"detail": "Only isolated US filing reads are allowed"}, status_code=403
        )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-StockPilot-Fixture"] = "synthetic-only"
    return response


app.include_router(company.router)


@app.get("/__loadtest__/manifest")
async def manifest():
    return {
        "contract": "stockpilot-isolated-load-v1",
        "isolated": True,
        "upstream": "mock",
        "database": "none",
        "redis": False,
        "workers": 1,
        "cacheState": "warm",
        "writes": False,
        "scope": "actual US-company router + SEC parser/cache; synthetic upstream",
    }


@app.get("/__loadtest__/stats")
async def stats():
    return {
        "syntheticUpstream": dict(COUNTS),
        "cacheEntries": len(service._cache),
        "locks": len(service._locks),
    }


if __name__ == "__main__":
    print("SYNTHETIC ONLY: localhost:8276; no production DB, Redis, KIS or SEC calls")
    uvicorn.run(app, host="127.0.0.1", port=8276, access_log=False)
