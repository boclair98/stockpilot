"""Read-only provider rankings. No trading or web bootstrap modifications."""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from app.core.traffic import traffic_store
from app.services.instrument_catalog import instrument_catalog
from app.services.kis_market import kis_market

TTL = 120
MAX_PROVIDER_PAGES = 3
MAX_ROWS = 600


def number(value: object, *, positive: bool = False) -> Decimal | None:
    try:
        n = Decimal(str(value).replace(",", ""))
        return (
            n
            if n.is_finite() and abs(n) < Decimal("1e30") and (not positive or n > 0)
            else None
        )
    except (InvalidOperation, TypeError, ValueError):
        return None


def request_spec(
    market: str, metric: str, exchange: str, key: str = ""
) -> tuple[str, str, dict]:
    if market not in {"KR", "US"} or metric not in {"CAP", "VOLUME", "UP", "DOWN"}:
        raise ValueError("Invalid ranking request")
    if market == "US":
        if exchange not in {"NAS", "NYS", "AMS"}:
            raise ValueError("Invalid US exchange")
        params = {"EXCD": exchange, "VOL_RANG": "0", "KEYB": key, "AUTH": ""}
        if metric == "CAP":
            params["CURR_GB"] = "0"
            return "/uapi/overseas-stock/v1/ranking/market-cap", "HHDFS76350100", params
        params["NDAY"] = "0"
        if metric == "VOLUME":
            params.update(PRC1="", PRC2="")
            return "/uapi/overseas-stock/v1/ranking/trade-vol", "HHDFS76310010", params
        params["GUBN"] = "1" if metric == "UP" else "0"
        return "/uapi/overseas-stock/v1/ranking/updown-rate", "HHDFS76290000", params
    if exchange not in {"ALL", "KOSPI", "KOSDAQ"}:
        raise ValueError("Invalid KR market")
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": {"ALL": "0000", "KOSPI": "0001", "KOSDAQ": "1001"}[exchange],
        "FID_DIV_CLS_CODE": "0",
        "FID_INPUT_PRICE_1": "",
        "FID_INPUT_PRICE_2": "",
        "FID_VOL_CNT": "",
        "FID_TRGT_CLS_CODE": "0",
        "FID_TRGT_EXLS_CLS_CODE": "0",
    }
    if metric == "CAP":
        params["FID_COND_SCR_DIV_CODE"] = "20174"
        return "/uapi/domestic-stock/v1/ranking/market-cap", "FHPST01740000", params
    params.update(FID_TRGT_CLS_CODE="111111111", FID_TRGT_EXLS_CLS_CODE="0000000000")
    if metric == "VOLUME":
        params.update(
            FID_COND_SCR_DIV_CODE="20171", FID_BLNG_CLS_CODE="0", FID_INPUT_DATE_1=""
        )
        return "/uapi/domestic-stock/v1/quotations/volume-rank", "FHPST01710000", params
    params.update(
        FID_COND_SCR_DIV_CODE="20170",
        FID_RANK_SORT_CLS_CODE="0" if metric == "UP" else "1",
        FID_INPUT_CNT_1="0",
        FID_PRC_CLS_CODE="0",
        FID_RSFL_RATE1="",
        FID_RSFL_RATE2="",
    )
    return "/uapi/domestic-stock/v1/ranking/fluctuation", "FHPST01700000", params


def normalize_row(raw: dict, market: str, exchange: str, as_of: str) -> dict | None:
    symbol = str(
        (raw.get("mksc_shrn_iscd") or raw.get("stck_shrn_iscd"))
        if market == "KR"
        else raw.get("symb", "")
    ).strip()
    if not re.fullmatch(
        r"\d{6}" if market == "KR" else r"[A-Z0-9][A-Z0-9.\-]{0,11}", symbol
    ):
        return None
    if market == "US" and raw.get("excd") not in {None, "", exchange}:
        return None
    price = number(raw.get("stck_prpr" if market == "KR" else "last"), positive=True)
    if price is None:
        return None
    name = str(
        raw.get("hts_kor_isnm" if market == "KR" else "name")
        or raw.get("ename")
        or symbol
    ).strip()[:120]
    rate = number(raw.get("prdy_ctrt" if market == "KR" else "rate"))
    if market == "US" and rate is not None and str(raw.get("sign")) in {"4", "5"}:
        rate = -abs(rate)
    volume = number(raw.get("acml_vol" if market == "KR" else "tvol"))
    shares = number(raw.get("lstn_stcn" if market == "KR" else "shar"), positive=True)
    cap = None
    reported = number(raw.get("stck_avls" if market == "KR" else "tomv"), positive=True)
    if (
        shares is not None
        and shares == shares.to_integral_value()
        and reported is not None
    ):
        expected = price * shares
        for scale in (Decimal(1), Decimal(1_000_000), Decimal(100_000_000)):
            candidate = reported * scale
            if abs(candidate - expected) / expected <= Decimal("0.03"):
                cap = candidate
                break
    return {
        "symbol": symbol,
        "name": name,
        "market": market,
        "currency": "KRW" if market == "KR" else "USD",
        "exchange": "KRX" if market == "KR" else exchange,
        "price": float(price),
        "changePercent": float(rate) if rate is not None else None,
        "volume": float(volume) if volume is not None and volume >= 0 else None,
        "marketCapEok": float(cap / Decimal(100_000_000))
        if cap is not None and market == "KR"
        else None,
        "marketCapUsd": float(cap) if cap is not None and market == "US" else None,
        "asOf": as_of,
        "source": "KIS 순위 API 조회",
        "marketState": "시세 조회 시각 기준",
    }


def ordered_rows(rows: list[dict], market: str, metric: str) -> list[dict]:
    key = "marketCapEok" if market == "KR" else "marketCapUsd"
    if metric == "VOLUME":
        key = "volume"
    elif metric in {"UP", "DOWN"}:
        key = "changePercent"
    unique = {}
    for row in rows:
        value = row.get(key)
        if (
            value is None
            or (metric == "UP" and value <= 0)
            or (metric == "DOWN" and value >= 0)
        ):
            continue
        unique.setdefault((row["exchange"], row["symbol"]), row)
    return sorted(
        unique.values(),
        key=lambda r: (r[key] if metric == "DOWN" else -r[key], r["symbol"]),
    )[:MAX_ROWS]


async def provider_exchange(market: str, metric: str, exchange: str) -> dict:
    async def fetch() -> dict:
        if not kis_market.configured:
            raise ValueError("Market provider is not configured")
        rows = []
        seen = set()
        key = ""
        continued = False
        as_of = datetime.now(UTC).isoformat()
        more = False
        for _ in range(MAX_PROVIDER_PAGES):
            path, tr_id, params = request_spec(market, metric, exchange, key)
            async with kis_market._rest_slot():
                await kis_market._rate_limit_rest()
                token = await kis_market._token()
                headers = kis_market._headers(token, tr_id)
                if continued:
                    headers["tr_cont"] = "N"
                response = await kis_market._client().get(
                    f"{kis_market.rest_base}{path}",
                    headers=headers,
                    params=params,
                    timeout=5,
                )
            data = response.json()
            if (
                not response.is_success
                or not isinstance(data, dict)
                or data.get("rt_cd") != "0"
            ):
                raise ValueError("Market ranking provider unavailable")
            raw_rows = data.get("output" if market == "KR" else "output2")
            if not isinstance(raw_rows, list):
                raise ValueError("Invalid ranking response")
            output1 = data.get("output1")
            if (
                market == "US"
                and metric == "CAP"
                and (not isinstance(output1, dict) or output1.get("curr") != "USD")
            ):
                raise ValueError("Unverified US market cap currency")
            added = 0
            for raw in raw_rows:
                if not isinstance(raw, dict):
                    continue
                row = normalize_row(raw, market, exchange, as_of)
                if row and row["symbol"] not in seen:
                    seen.add(row["symbol"])
                    rows.append(row)
                    added += 1
            more = response.headers.get("tr_cont") in {"M", "F"}
            next_key = str(output1.get("keyb", "")) if isinstance(output1, dict) else ""
            if not more or not added:
                more = more and added > 0
                break
            if market == "US":
                # KEYB is a consumed-row offset in current KIS responses and
                # only takes effect together with the tr_cont=N header.
                if not next_key and (not key or key.isdigit()) and raw_rows:
                    next_key = str(int(key or "0") + len(raw_rows))
                if not next_key or next_key == key or len(next_key) > 256:
                    break
                key = next_key
            continued = True
        return {"rows": rows, "asOf": as_of, "providerHasMore": more}

    cache_key = f"market:rankings:v2:{market}:{metric}:{exchange}"

    async def resilient_fetch() -> dict:
        try:
            result = await asyncio.wait_for(fetch(), timeout=12)
            await traffic_store.set_json(cache_key + ":last", result, 900)
            return {**result, "stale": False, "failed": False}
        except Exception:
            last = await traffic_store.get_json(cache_key + ":last")
            return {
                **(last or {"rows": [], "asOf": None, "providerHasMore": False}),
                "stale": bool(last),
                "failed": True,
            }

    return await traffic_store.get_or_set(cache_key, TTL, resilient_fetch)


async def ranking_snapshot(market: str, metric: str, exchange: str) -> dict:
    exchanges = (
        ["NAS", "NYS", "AMS"] if market == "US" and exchange == "ALL" else [exchange]
    )
    parts = await asyncio.gather(
        *(provider_exchange(market, metric, e) for e in exchanges)
    )
    rows = ordered_rows([row for part in parts for row in part["rows"]], market, metric)
    for row in rows:
        item = instrument_catalog.get_cached(row["symbol"], market, row["exchange"])
        if item:
            row.update(
                {
                    key: value
                    for key, value in item.public().items()
                    if key in {"name", "englishName", "logoUrl", "id"}
                }
            )
    for row in rows:
        item = instrument_catalog.get_cached(row["symbol"], market, row["exchange"])
        if item:
            row.update(
                {
                    key: value
                    for key, value in item.public().items()
                    if key in {"name", "englishName", "logoUrl", "id"}
                }
            )
    times = [part["asOf"] for part in parts if part["asOf"]]
    return {
        "items": rows,
        "market": market,
        "metric": metric,
        "exchange": exchange,
        "asOf": min(times) if times else None,
        "stale": any(p["stale"] for p in parts),
        "partial": any(p["failed"] for p in parts),
        "providerHasMore": any(p["providerHasMore"] for p in parts),
        "scope": "KRX 순위 조회"
        if market == "KR"
        else " · ".join(exchanges) + " 순위 조회 통합",
        "source": "한국투자증권 순위 API",
        "refreshSeconds": TTL,
    }
