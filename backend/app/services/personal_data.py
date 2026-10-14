"""Read-only public data. Missing/partial source data is never invented."""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

import httpx

from app.core.traffic import traffic_store
from app.services.kis_market import kis_market
from app.services.personal_math import parse_ecb


async def reference_fx():
    async def load():
        async with httpx.AsyncClient(timeout=6, follow_redirects=False) as client:
            response = await client.get(
                "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
                headers={"User-Agent": "StockPilot/1.0 exchange-reference"},
            )
            response.raise_for_status()
            result = parse_ecb(response.text, datetime.now(UTC).date())
            result["asOf"] = datetime.now(UTC).isoformat()
            return result

    result = await asyncio.wait_for(
        traffic_store.get_or_set("personal:ecb-fx:v1", 3600, load), timeout=8
    )
    # A cache hit is not permission to use an obsolete reference date.
    observed = datetime.fromisoformat(result["date"]).date()
    if not 0 <= (datetime.now(UTC).date() - observed).days <= 7:
        raise ValueError("환율 기준일이 오래됐어요.")
    return result


def valid_day(value):
    try:
        return datetime.strptime(str(value), "%Y%m%d").date().isoformat()
    except (ValueError, TypeError):
        return None


def positive(value):
    try:
        number = Decimal(str(value).replace(",", ""))
        return str(number) if number.is_finite() and number > 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


async def corporate_schedule(instrument):
    async def load():
        if not kis_market.configured:
            raise ValueError("시세 제공 설정을 확인해 주세요.")
        now = datetime.now(UTC)
        start, end = (
            (now - timedelta(days=30)).strftime("%Y%m%d"),
            (now + timedelta(days=120)).strftime("%Y%m%d"),
        )

        async def get(path, tr_id, params):
            async with kis_market._rest_slot():
                await kis_market._rate_limit_rest()
                token = await kis_market._token()
                response = await kis_market._client().get(
                    kis_market.rest_base + path,
                    headers=kis_market._headers(token, tr_id),
                    params=params,
                )
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict) or payload.get("rt_cd") != "0":
                    raise ValueError("권리 일정을 조회하지 못했어요.")
                rows = (
                    payload.get("output1")
                    if instrument.market == "KR"
                    else payload.get("output")
                )
                if isinstance(rows, dict):
                    rows = [rows]
                if not isinstance(rows, list):
                    raise ValueError("권리 일정 응답을 확인하지 못했어요.")
                return rows[:100], response.headers.get("tr_cont") in {"M", "F"}

        items, partial = [], False
        if instrument.market == "KR":
            results = await asyncio.gather(
                get(
                    "/uapi/domestic-stock/v1/ksdinfo/dividend",
                    "HHKDB669102C0",
                    {
                        "CTS": "",
                        "GB1": "0",
                        "F_DT": start,
                        "T_DT": end,
                        "SHT_CD": instrument.symbol,
                        "HIGH_GB": "",
                    },
                ),
                get(
                    "/uapi/domestic-stock/v1/ksdinfo/rev-split",
                    "HHKDB669105C0",
                    {
                        "SHT_CD": instrument.symbol,
                        "CTS": "",
                        "F_DT": start,
                        "T_DT": end,
                        "MARKET_GB": "0",
                    },
                ),
                return_exceptions=True,
            )
            for kind, result in zip(("DIVIDEND", "SPLIT"), results, strict=True):
                if isinstance(result, Exception):
                    partial = True
                    continue
                rows, more = result
                partial |= more
                for row in rows:
                    if str(row.get("sht_cd", "")) != instrument.symbol:
                        continue
                    record = valid_day(row.get("record_date"))
                    if not record:
                        continue
                    before, after = (
                        positive(row.get("inter_bf_face_amt")),
                        positive(row.get("inter_af_face_amt")),
                    )
                    items.append(
                        {
                            "kind": kind,
                            "recordDate": record,
                            "payDate": valid_day(
                                row.get("divi_pay_dt")
                                if kind == "DIVIDEND"
                                else row.get("list_dt")
                            ),
                            "perShare": positive(row.get("per_sto_divi_amt"))
                            if kind == "DIVIDEND"
                            else None,
                            "ratio": str(Decimal(before) / Decimal(after))
                            if before and after
                            else None,
                            "currency": "KRW",
                            "confirmed": False,
                        }
                    )
        else:
            rows, partial = await get(
                "/uapi/overseas-price/v1/quotations/period-rights",
                "CTRGT011R",
                {
                    "RGHT_TYPE_CD": "%%",
                    "INQR_DVSN_CD": "02",
                    "INQR_STRT_DT": start,
                    "INQR_END_DT": end,
                    "PDNO": instrument.symbol,
                    "PRDT_TYPE_CD": "",
                    "CTX_AREA_NK50": "",
                    "CTX_AREA_FK50": "",
                },
            )
            for row in rows:
                if str(row.get("pdno", "")).upper() != instrument.symbol or row.get(
                    "rght_type_cd"
                ) not in {"03", "14", "15", "75"}:
                    continue
                record = valid_day(row.get("acpl_bass_dt"))
                if record:
                    # Record day is NOT an ex-date or a payment date. Never
                    # convert a provider's unqualified stock ratio into cash.
                    items.append(
                        {
                            "kind": "DIVIDEND"
                            if row["rght_type_cd"] in {"03", "75"}
                            else "SPLIT",
                            "recordDate": record,
                            "payDate": None,
                            "perShare": positive(row.get("alct_frcr_unpr"))
                            if row.get("crcy_cd") == "USD"
                            and row["rght_type_cd"] in {"03", "75"}
                            else None,
                            "ratio": None,
                            "currency": row.get("crcy_cd"),
                            "confirmed": row.get("dfnt_yn") in {"Y", "1"},
                        }
                    )
        return {
            "items": items,
            "partial": partial,
            "asOf": now.isoformat(),
            "source": "KIS 예탁원·해외 권리 일정",
            "sourceUrl": "https://apiportal.koreainvestment.com/apiservice-category",
            "note": "조회된 일정은 참고용이에요. 권리 기준 시각과 지급일을 확인한 이벤트만 계좌에 반영해요.",
        }

    return await asyncio.wait_for(
        traffic_store.get_or_set(f"personal:corporate:v2:{instrument.id}", 3600, load),
        timeout=10,
    )
