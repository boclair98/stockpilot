"""Isolated ASGI tests; no real database, quotes, or account writes."""
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from app.core.database import get_session
from app.core.practice import require_practice_identity
from app.routes.trading import router
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_lookup_is_scoped_read_only_and_not_cached():
    owner, other = uuid4(), uuid4()
    key = str(uuid4())
    row = SimpleNamespace(id=uuid4(), status="FILLED", exchange="NAS", fill_price=Decimal("123.45"), risk_code=None, reference_price=None, spread_bps=None, slippage_bps=None, participation_rate=None, reject_reason=None)
    statements = []

    class Session:
        async def execute(self, statement):
            params = statement.compile().params
            statements.append(params)
            found = row if owner in params.values() and key in params.values() else None
            return SimpleNamespace(scalar_one_or_none=lambda: found)

    app = FastAPI()
    app.include_router(router)
    async def session_override():
        return Session()
    async def owner_override():
        return owner
    async def other_override():
        return other
    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[require_practice_identity] = owner_override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"/api/trading/orders/request/{key}")
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json()["fillPrice"] == 123.45
        assert response.json()["currency"] == "USD"
        assert response.json()["replayed"] is True
        app.dependency_overrides[require_practice_identity] = other_override
        assert (await client.get(f"/api/trading/orders/request/{key}")).status_code == 404
        assert (await client.get("/api/trading/orders/request/short")).status_code == 400
    assert len(statements) == 2  # malformed key never reaches the DB
    assert all(len(params) == 2 for params in statements)


@pytest.mark.asyncio
async def test_lookup_requires_identity():
    async def signed_out():
        raise HTTPException(401, "로그인이 필요해요")
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_practice_identity] = signed_out
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get(f"/api/trading/orders/request/{uuid4()}")).status_code == 401
