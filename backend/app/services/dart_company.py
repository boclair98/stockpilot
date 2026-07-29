"""Cached OpenDART company profiles, financial highlights, and disclosures."""

from __future__ import annotations

import asyncio
import io
import re
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse
from xml.etree import ElementTree

import httpx

from app.core.config import settings

DART_API = "https://opendart.fss.or.kr/api"
CORP_CODE_TTL = timedelta(hours=24)
COMPANY_TTL = timedelta(minutes=15)
REPORT_NAMES = {
    "11013": "1분기보고서",
    "11012": "반기보고서",
    "11014": "3분기보고서",
    "11011": "사업보고서",
}
ACCOUNT_ALIASES = {
    "revenue": ("매출액", "영업수익", "수익(매출액)"),
    "operatingIncome": ("영업이익", "영업이익(손실)"),
    "netIncome": ("당기순이익(손실)", "당기순이익"),
    "assets": ("자산총계",),
    "liabilities": ("부채총계",),
    "equity": ("자본총계",),
}
ACCOUNT_LABELS = {
    "revenue": "매출액",
    "operatingIncome": "영업이익",
    "netIncome": "당기순이익",
    "assets": "자산총계",
    "liabilities": "부채총계",
    "equity": "자본총계",
}


class DartAPIError(RuntimeError):
    pass


def parse_amount(value: str | None) -> Decimal | None:
    if not value:
        return None
    normalized = re.sub(r"[,\s]", "", value)
    if normalized in {"", "-"}:
        return None
    if normalized.startswith("(") and normalized.endswith(")"):
        normalized = f"-{normalized[1:-1]}"
    try:
        return Decimal(normalized)
    except InvalidOperation:
        return None


def safe_http_url(value: str | None) -> str | None:
    normalized = (value or "").strip()
    if not normalized:
        return None
    parsed = urlparse(normalized)
    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.scheme:
        normalized = f"https://{normalized}"
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return normalized


def parse_corp_codes(content: bytes) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        xml = archive.read(archive.namelist()[0])
    root = ElementTree.fromstring(xml)
    codes: dict[str, str] = {}
    for item in root.findall("list"):
        stock_code = (item.findtext("stock_code") or "").strip()
        corp_code = (item.findtext("corp_code") or "").strip()
        if len(stock_code) == 6 and stock_code.isdigit() and len(corp_code) == 8:
            codes[stock_code] = corp_code
    return codes


def financial_highlights(rows: list[dict], year: int, report_code: str) -> dict:
    scope = "CFS" if any(row.get("fs_div") == "CFS" for row in rows) else "OFS"
    scoped = [row for row in rows if row.get("fs_div") == scope]
    metrics = []
    for key, aliases in ACCOUNT_ALIASES.items():
        row = next(
            (item for item in scoped if item.get("account_nm") in aliases),
            None,
        )
        if not row:
            continue
        amount_field = (
            "thstrm_add_amount"
            if key in {"revenue", "operatingIncome", "netIncome"}
            and row.get("thstrm_add_amount")
            else "thstrm_amount"
        )
        amount = parse_amount(row.get(amount_field))
        if amount is None:
            continue
        metrics.append(
            {
                "key": key,
                "label": ACCOUNT_LABELS[key],
                "value": float(amount),
                "currency": row.get("currency") or "KRW",
            }
        )
    return {
        "year": year,
        "reportCode": report_code,
        "reportName": REPORT_NAMES[report_code],
        "scope": "연결" if scope == "CFS" else "별도",
        "metrics": metrics,
    }


def report_candidates(today: date) -> list[tuple[int, str]]:
    candidates: list[tuple[int, str]] = []
    if today.month >= 11:
        candidates.append((today.year, "11014"))
    if today.month >= 8:
        candidates.append((today.year, "11012"))
    if today.month >= 5:
        candidates.append((today.year, "11013"))
    candidates.append((today.year - 1, "11011"))
    return candidates


class DartCompanyService:
    def __init__(self) -> None:
        self._corp_codes: dict[str, str] = {}
        self._corp_codes_at: datetime | None = None
        self._company_cache: dict[str, tuple[datetime, dict]] = {}
        self._codes_lock = asyncio.Lock()
        self._company_locks: dict[str, asyncio.Lock] = {}

    @property
    def configured(self) -> bool:
        return bool(settings.dart_api_key)

    async def _json(
        self, client: httpx.AsyncClient, endpoint: str, params: dict
    ) -> dict:
        response = await client.get(
            f"{DART_API}/{endpoint}",
            params={"crtfc_key": settings.dart_api_key, **params},
        )
        response.raise_for_status()
        payload = response.json()
        status = payload.get("status")
        if status not in {"000", "013"}:
            raise DartAPIError(payload.get("message") or "OpenDART 요청 실패")
        return payload

    async def _ensure_corp_codes(self, client: httpx.AsyncClient) -> None:
        now = datetime.now(UTC)
        if (
            self._corp_codes
            and self._corp_codes_at
            and now - self._corp_codes_at < CORP_CODE_TTL
        ):
            return
        async with self._codes_lock:
            if (
                self._corp_codes
                and self._corp_codes_at
                and now - self._corp_codes_at < CORP_CODE_TTL
            ):
                return
            response = await client.get(
                f"{DART_API}/corpCode.xml",
                params={"crtfc_key": settings.dart_api_key},
            )
            response.raise_for_status()
            self._corp_codes = parse_corp_codes(response.content)
            self._corp_codes_at = now

    async def _latest_financials(
        self, client: httpx.AsyncClient, corp_code: str
    ) -> dict | None:
        for year, report_code in report_candidates(datetime.now(UTC).date()):
            payload = await self._json(
                client,
                "fnlttSinglAcnt.json",
                {
                    "corp_code": corp_code,
                    "bsns_year": str(year),
                    "reprt_code": report_code,
                },
            )
            rows = payload.get("list") or []
            if rows:
                result = financial_highlights(rows, year, report_code)
                if result["metrics"]:
                    return result
        return None

    async def company(self, symbol: str) -> dict:
        symbol = symbol.strip()
        if not self.configured:
            return {"configured": False, "available": False, "symbol": symbol}
        if len(symbol) != 6 or not symbol.isdigit():
            return {"configured": True, "available": False, "symbol": symbol}

        cached = self._company_cache.get(symbol)
        now = datetime.now(UTC)
        if cached and now - cached[0] < COMPANY_TTL:
            return cached[1]

        lock = self._company_locks.setdefault(symbol, asyncio.Lock())
        async with lock:
            cached = self._company_cache.get(symbol)
            if cached and now - cached[0] < COMPANY_TTL:
                return cached[1]

            timeout = httpx.Timeout(20, connect=8)
            async with httpx.AsyncClient(timeout=timeout) as client:
                await self._ensure_corp_codes(client)
                corp_code = self._corp_codes.get(symbol)
                if not corp_code:
                    return {
                        "configured": True,
                        "available": False,
                        "symbol": symbol,
                    }

                year_ago = (now - timedelta(days=365)).strftime("%Y%m%d")
                profile_task = self._json(
                    client, "company.json", {"corp_code": corp_code}
                )
                disclosures_task = self._json(
                    client,
                    "list.json",
                    {
                        "corp_code": corp_code,
                        "bgn_de": year_ago,
                        "page_no": "1",
                        "page_count": "8",
                        "sort": "date",
                        "sort_mth": "desc",
                    },
                )
                profile, disclosures, financials = await asyncio.gather(
                    profile_task,
                    disclosures_task,
                    self._latest_financials(client, corp_code),
                )

            result = {
                "configured": True,
                "available": True,
                "symbol": symbol,
                "profile": {
                    "name": profile.get("corp_name"),
                    "englishName": profile.get("corp_name_eng"),
                    "ceo": profile.get("ceo_nm"),
                    "market": profile.get("corp_cls"),
                    "establishedAt": profile.get("est_dt"),
                    "fiscalMonth": profile.get("acc_mt"),
                    "homepage": safe_http_url(profile.get("hm_url")),
                    "address": profile.get("adres"),
                },
                "financials": financials,
                "disclosures": [
                    {
                        "receiptNo": item.get("rcept_no"),
                        "title": item.get("report_nm"),
                        "date": item.get("rcept_dt"),
                        "submitter": item.get("flr_nm"),
                        "url": (
                            "https://dart.fss.or.kr/dsaf001/main.do"
                            f"?rcpNo={item.get('rcept_no')}"
                        ),
                    }
                    for item in disclosures.get("list") or []
                ],
                "source": "금융감독원 OpenDART",
                "asOf": now.isoformat(),
            }
            self._company_cache[symbol] = (now, result)
            return result


dart_company = DartCompanyService()
