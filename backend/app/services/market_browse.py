"""On-demand provider continuation; never preload an entire market per visitor."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime

from app.core.traffic import traffic_store
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market
from app.services.market_rankings import normalize_row, ordered_rows, request_spec

SNAPSHOT_TTL = 900
MAX_READ = 50000


class SnapshotExpired(ValueError):
    pass


async def extend_exchange(
    market: str, metric: str, exchange: str, epoch: str, target: int
) -> dict:
    digest = hashlib.sha256(epoch.encode()).hexdigest()[:24]
    state_key = f"market:browse:v1:{market}:{metric}:{exchange}:{digest}"
    window_key = f"{state_key}:window:{(target + 99) // 100}"

    async def extend() -> bool:
        lease = await traffic_store.acquire_lock(state_key, ttl_seconds=30)
        if not lease:
            # Another prefix request may be extending this same snapshot.
            for _ in range(30):
                await asyncio.sleep(0.1)
                state = await traffic_store.get_json(state_key)
                if state and (
                    len(ordered_rows(state["rows"], market, metric, MAX_READ)) >= target
                    or not state["more"]
                ):
                    return True
            return False
        try:
            state = await traffic_store.get_json(state_key) or {
                "rows": [],
                "consumed": 0,
                "more": True,
                "failed": False,
                "retryAt": 0,
                "asOf": epoch,
            }
            if state["retryAt"] > datetime.now(UTC).timestamp():
                return False
            seen = {r["symbol"] for r in state["rows"]}
            try:
                for _ in range(3):
                    if (
                        not state["more"]
                        or len(ordered_rows(state["rows"], market, metric, MAX_READ))
                        >= target
                    ):
                        break
                    if not kis_market.configured:
                        raise ValueError("Provider unavailable")
                    consumed = state["consumed"]
                    path, tr, params = request_spec(
                        market, metric, exchange, str(consumed) if consumed else ""
                    )
                    async with kis_market._rest_slot():
                        await kis_market._rate_limit_rest()
                        token = await kis_market._token()
                        headers = kis_market._headers(token, tr)
                        if consumed:
                            headers["tr_cont"] = "N"
                        response = await kis_market._client().get(
                            kis_market.rest_base + path,
                            params=params,
                            headers=headers,
                            timeout=5,
                        )
                    data = response.json()
                    if (
                        not response.is_success
                        or not isinstance(data, dict)
                        or data.get("rt_cd") != "0"
                    ):
                        raise ValueError("Provider unavailable")
                    meta = data.get("output1", {})
                    if (
                        market == "US"
                        and metric == "CAP"
                        and (not isinstance(meta, dict) or meta.get("curr") != "USD")
                    ):
                        raise ValueError("Unverified currency")
                    raw = data.get("output" if market == "KR" else "output2")
                    if not isinstance(raw, list):
                        raise ValueError("Invalid provider page")
                    added = 0
                    previous_symbols = set(seen)
                    raw_symbols = set()
                    for item in raw:
                        if isinstance(item, dict):
                            symbol = (
                                (
                                    item.get("mksc_shrn_iscd")
                                    or item.get("stck_shrn_iscd")
                                )
                                if market == "KR"
                                else item.get("symb")
                            )
                            if symbol:
                                raw_symbols.add(str(symbol).strip())
                        row = (
                            normalize_row(item, market, exchange, epoch)
                            if isinstance(item, dict)
                            else None
                        )
                        if row and row["symbol"] not in seen:
                            seen.add(row["symbol"])
                            state["rows"].append(row)
                            added += 1
                    state["consumed"] += len(raw)
                    state["more"] = bool(raw) and response.headers.get("tr_cont") in {
                        "M",
                        "F",
                    }
                    if (
                        raw
                        and not added
                        and raw_symbols
                        and raw_symbols <= previous_symbols
                    ):
                        # A provider repeating its page must not create an endless loop.
                        state["more"] = False
                    state["failed"] = False
                    await traffic_store.set_json(state_key, state, SNAPSHOT_TTL)
            except Exception:
                state["failed"] = True
                state["retryAt"] = datetime.now(UTC).timestamp() + 15
                await traffic_store.set_json(state_key, state, SNAPSHOT_TTL)
                return False
            await traffic_store.set_json(state_key, state, SNAPSHOT_TTL)
            return True
        finally:
            await traffic_store.release_lock(state_key, lease)

    state = await traffic_store.get_json(state_key)
    if state and (
        len(ordered_rows(state["rows"], market, metric, MAX_READ)) >= target
        or not state["more"]
    ):
        return state
    # Cache the coordination marker, not repeated copies of the entire prefix.
    await traffic_store.get_or_set(window_key, 10, extend)
    return await traffic_store.get_json(state_key) or {
        "rows": [],
        "more": True,
        "failed": True,
        "asOf": epoch,
    }


async def browse_snapshot(
    market: str, metric: str, exchange: str, target: int, requested: str | None = None
) -> dict:
    base = f"market:browse:epoch:{market}:{metric}:{exchange}"

    async def new_epoch() -> str:
        return datetime.now(UTC).isoformat()

    current = await traffic_store.get_or_set(base, 120, new_epoch)
    epoch = requested or current
    exchanges = (
        ["NAS", "NYS", "AMS"] if market == "US" and exchange == "ALL" else [exchange]
    )
    if requested and requested != current:
        digest = hashlib.sha256(epoch.encode()).hexdigest()[:24]
        existing = await asyncio.gather(
            *(
                traffic_store.get_json(
                    f"market:browse:v1:{market}:{metric}:{e}:{digest}"
                )
                for e in exchanges
            )
        )
        if not all(existing):
            raise SnapshotExpired("Snapshot expired")
    parts = await asyncio.gather(
        *(extend_exchange(market, metric, e, epoch, target) for e in exchanges)
    )
    rows = ordered_rows([r for p in parts for r in p["rows"]], market, metric, MAX_READ)
    # If each non-exhausted exchange has N sorted rows, global top N is safe.
    # Do not append lower-cap exchanges ahead of unseen higher-cap rows.
    safe = [
        len(ordered_rows(p["rows"], market, metric, MAX_READ))
        for p in parts
        if p["more"]
    ]
    if safe:
        rows = rows[: min(safe)]
    for row in rows:
        item = instrument_catalog.get_cached(row["symbol"], market, row["exchange"])
        if item:
            row.update(
                {
                    k: v
                    for k, v in item.public().items()
                    if k in {"id", "name", "englishName", "logoUrl"}
                }
            )
    return {
        "items": rows,
        "market": market,
        "metric": metric,
        "exchange": exchange,
        "asOf": epoch,
        "providerHasMore": any(p["more"] for p in parts),
        "partial": any(p["failed"] for p in parts),
        "stale": False,
        "scope": "KRX 순위 조회"
        if market == "KR"
        else " · ".join(exchanges) + " 순위 조회 통합",
        "source": "한국투자증권 순위 API",
        "refreshSeconds": 120,
    }
