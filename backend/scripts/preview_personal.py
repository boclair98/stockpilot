"""Opt-in, loopback-only isolated UI verification. SQLite in memory; no production."""
import os
import sys
from pathlib import Path
from uuid import UUID
from datetime import UTC, datetime, timedelta

if os.getenv("PERSONAL_FIXTURE") != "1":
    raise SystemExit("Set PERSONAL_FIXTURE=1 to run disposable verification fixtures.")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
import uvicorn

from app.core.database import get_session
from app.core.identity import require_identity
from app.models import TradingAccount, TradeOrder
from app.routes import personal
from app.services import personal_data
from app.services.instrument_catalog import TOP_INSTRUMENTS, instrument_catalog
from tests.test_personal_tools import store as store_fixture, wallet

OWNER = UUID("a0000000-0000-0000-0000-000000000123")
generator = store_fixture.__wrapped__()
store = next(generator)
wallet(store, OWNER)
if os.getenv("PERSONAL_INBOX_FIXTURE") == "1":
    at = datetime.now(UTC) - timedelta(minutes=10)
    for index in range(70):
        store.add(TradeOrder(owner_id=OWNER, symbol="005930", exchange="KRX", side="BUY", order_type="MARKET", quantity=index + 1, status="REJECTED", reject_reason="격리된 화면 검증 기록 · 실제 주문 아님", created_at=at, processed_at=at))
    store.session.flush()
app = FastAPI()
app.include_router(personal.router)


async def session():
    with store.session.begin_nested():
        yield store


async def owner():
    return OWNER


async def catalog(symbol, market=None, exchange=None):
    return next((row for row in TOP_INSTRUMENTS if row.symbol == symbol and (not market or row.market == market) and (not exchange or row.exchange == exchange)), None)


async def fx():
    return {"rate": "1400.000000", "date": "2026-10-13", "source": "격리 검증 환율", "sourceUrl": "https://www.ecb.europa.eu/"}


async def schedule(item):
    return {"items": [], "partial": False, "note": "격리된 로컬 검증 자료 · 실제 권리 지급 없음"}


app.dependency_overrides[get_session] = session
app.dependency_overrides[require_identity] = owner
instrument_catalog.get = catalog
personal.reference_fx = fx
personal_data.corporate_schedule = schedule
personal.corporate_schedule = schedule


@app.get("/api/trading/portfolio")
async def portfolio():
    row = await store.get(TradingAccount, OWNER)
    return {"authenticated": True, "cash": {"KRW": float(row.cash_krw), "USD": float(row.cash)}, "positions": [], "orders": [], "protections": []}


if __name__ == "__main__":
    print("Isolated SQLite fixture: 127.0.0.1:5234; no production connection")
    uvicorn.run(app, host="127.0.0.1", port=5234)
