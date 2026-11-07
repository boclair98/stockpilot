"""Expected-owner write preconditions with SQLite/ASGI only; no live accounts."""

from uuid import uuid4

import httpx
import pytest
import sqlalchemy as sa
from app.models import TradingAccount
from app.personal_models import SavedItem
from app.routes import personal
from tests import test_personal_tools as fixtures

api, store, wallet = fixtures.api, fixtures.store, fixtures.wallet
pytestmark = pytest.mark.no_db


def saved_rows(store):
    return sorted(
        (str(row.owner_id), row.kind, row.key, row.version, row.deleted, repr(row.data))
        for row in store.session.scalars(sa.select(SavedItem))
    )


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
@pytest.mark.parametrize("kind", ["NOTE", "FAVORITE", "COMPARE"])
async def test_stale_expected_owner_blocks_before_catalog_account_or_saved_access(
    api, store, monkeypatch, method, kind
):
    stale_owner, signed_in_owner = wallet(store), wallet(store)
    for owner, note in [(stale_owner, "private-A"), (signed_in_owner, "private-B")]:
        store.add(
            SavedItem(
                owner_id=owner,
                kind=kind,
                key="KRX:005930",
                data={"note": note},
                version=1,
                deleted=False,
            )
        )
    await store.flush()
    before = saved_rows(store)

    async def forbidden(*args, **kwargs):
        raise AssertionError("Owner mismatch must fail before any storage/catalog access")

    monkeypatch.setattr(personal, "canonical_saved", forbidden)
    monkeypatch.setattr(personal, "account", forbidden)
    monkeypatch.setattr(store, "get", forbidden)
    monkeypatch.setattr(store, "execute", forbidden)
    monkeypatch.setattr(store, "scalar", forbidden)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        response = await client.request(
            method,
            f"/api/personal/saved/{kind}/KRX:005930?version=1",
            json={"data": {"note": "stale-A-draft"}, "version": 1}
            if method == "PUT" else None,
            headers={
                "X-Test-Owner": str(signed_in_owner),
                "X-StockPilot-Owner": str(stale_owner),
            },
        )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "OWNER_CHANGED"
    assert set(response.json()["detail"]) == {"code", "message"}
    assert str(signed_in_owner) not in response.text
    assert str(stale_owner) not in response.text
    assert "private-B" not in response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert saved_rows(store) == before


@pytest.mark.parametrize("expected", [None, "MATCH"])
async def test_matching_and_legacy_headers_allow_only_the_signed_in_owner(api, store, expected):
    owner, other = wallet(store), wallet(store)
    headers = {"X-Test-Owner": str(owner)}
    if expected:
        headers["X-StockPilot-Owner"] = str(owner)
    url = "/api/personal/saved/NOTE/KRX:005930"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        created = await client.put(url, headers=headers, json={"data": {"note": "my-note"}, "version": 0})
        assert created.status_code == 200 and created.json()["version"] == 1
        assert store.session.get(SavedItem, (owner, "NOTE", "KRX:005930")).data == {"note": "my-note"}
        assert store.session.get(SavedItem, (other, "NOTE", "KRX:005930")) is None
        deleted = await client.delete(url + "?version=1", headers=headers)
        assert deleted.status_code == 200 and deleted.json()["deleted"] is True
        assert deleted.json()["version"] == 2


@pytest.mark.parametrize("expected", ["", " ", "not-an-owner"])
async def test_supplied_empty_or_invalid_owner_is_not_treated_as_legacy(api, store, expected):
    owner = wallet(store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        response = await client.put(
            "/api/personal/saved/NOTE/KRX:005930",
            headers={"X-Test-Owner": str(owner), "X-StockPilot-Owner": expected},
            json={"data": {"note": "must-not-save"}, "version": 0},
        )
    assert response.status_code == 409
    assert not saved_rows(store)


async def test_owner_header_is_never_authentication_and_mismatch_cannot_create_account(api, store):
    owner = uuid4()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://test"
    ) as client:
        payload = {"data": {"note": "must-not-save"}, "version": 0}
        assert (await client.put(
            "/api/personal/saved/NOTE/KRX:005930",
            headers={"X-StockPilot-Owner": str(owner)}, json=payload,
        )).status_code == 401
        assert (await client.put(
            "/api/personal/saved/NOTE/KRX:005930",
            headers={"X-Test-Owner": str(owner), "X-StockPilot-Owner": str(uuid4())}, json=payload,
        )).status_code == 409
    assert store.session.get(TradingAccount, owner) is None
    assert not saved_rows(store)
