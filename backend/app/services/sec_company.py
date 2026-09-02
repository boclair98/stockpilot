"""Small, cached SEC EDGAR reader for US-company filing history."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import httpx

from app.core.config import settings

SEC_DATA = "https://data.sec.gov"
SEC_WEB = "https://www.sec.gov"
TICKER_TTL = timedelta(hours=24)
COMPANY_TTL = timedelta(minutes=15)
FILING_FORMS = {"8-K", "10-K", "10-Q", "20-F", "40-F", "6-K"}


class SecAPIError(RuntimeError):
    pass


def parse_ticker_directory(payload: dict) -> dict[str, dict[str, str]]:
    """Normalize SEC's numeric-keyed ticker directory for exact lookup."""

    result: dict[str, dict[str, str]] = {}
    for row in payload.values():
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("ticker") or "").strip().upper()
        cik = str(row.get("cik_str") or "").strip()
        title = str(row.get("title") or "").strip()
        if ticker and cik.isdigit():
            result[ticker] = {"cik": cik.zfill(10), "title": title}
    return result


def parse_recent_filings(payload: dict) -> list[dict]:
    recent = payload.get("filings", {}).get("recent", {})
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accessions = recent.get("accessionNumber") or []
    documents = recent.get("primaryDocument") or []
    descriptions = recent.get("primaryDocDescription") or []
    cik = str(payload.get("cik") or "").zfill(10)
    rows: list[dict] = []
    for index, form in enumerate(forms):
        if form not in FILING_FORMS:
            continue
        accession = str(accessions[index] if index < len(accessions) else "")
        document = str(documents[index] if index < len(documents) else "")
        filing_date = str(dates[index] if index < len(dates) else "")
        if not accession or not document or not filing_date:
            continue
        accession_path = accession.replace("-", "")
        rows.append(
            {
                "receiptNo": accession,
                "title": " · ".join(
                    part
                    for part in (
                        form,
                        str(descriptions[index]) if index < len(descriptions) else "",
                    )
                    if part
                ),
                "date": filing_date.replace("-", ""),
                "submitter": "SEC EDGAR",
                "url": (
                    f"{SEC_WEB}/Archives/edgar/data/{int(cik)}/"
                    f"{accession_path}/{document}"
                ),
            }
        )
        if len(rows) >= 8:
            break
    return rows


class SecCompanyService:
    def __init__(self) -> None:
        self._ticker_directory: dict[str, dict[str, str]] = {}
        self._ticker_directory_at: datetime | None = None
        self._cache: dict[str, tuple[datetime, dict]] = {}
        self._directory_lock = asyncio.Lock()
        self._company_locks: dict[str, asyncio.Lock] = {}

    @property
    def configured(self) -> bool:
        # SEC asks automated clients to identify themselves with a useful
        # User-Agent and a reachable contact address.
        return bool(settings.sec_user_agent)

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": settings.sec_user_agent or "StockPilot/1.0",
            "Accept-Encoding": "gzip, deflate",
        }

    async def _get_json(self, client: httpx.AsyncClient, url: str) -> dict:
        response = await client.get(url, headers=self._headers())
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise SecAPIError("SEC 응답 형식이 올바르지 않습니다.")
        return payload

    async def _ensure_tickers(self, client: httpx.AsyncClient) -> None:
        now = datetime.now(UTC)
        if (
            self._ticker_directory
            and self._ticker_directory_at
            and now - self._ticker_directory_at < TICKER_TTL
        ):
            return
        async with self._directory_lock:
            if (
                self._ticker_directory
                and self._ticker_directory_at
                and now - self._ticker_directory_at < TICKER_TTL
            ):
                return
            payload = await self._get_json(
                client, f"{SEC_WEB}/files/company_tickers.json"
            )
            self._ticker_directory = parse_ticker_directory(payload)
            self._ticker_directory_at = now

    async def company(self, symbol: str) -> dict:
        symbol = symbol.strip().upper()
        base = {"configured": self.configured, "available": False, "symbol": symbol}
        if not self.configured or not symbol:
            return base

        now = datetime.now(UTC)
        cached = self._cache.get(symbol)
        if cached and now - cached[0] < COMPANY_TTL:
            return cached[1]

        lock = self._company_locks.setdefault(symbol, asyncio.Lock())
        async with lock:
            cached = self._cache.get(symbol)
            if cached and now - cached[0] < COMPANY_TTL:
                return cached[1]
            timeout = httpx.Timeout(15, connect=8)
            async with httpx.AsyncClient(timeout=timeout) as client:
                await self._ensure_tickers(client)
                directory = self._ticker_directory.get(symbol)
                if not directory:
                    return base
                cik = directory["cik"]
                payload = await self._get_json(
                    client, f"{SEC_DATA}/submissions/CIK{cik}.json"
                )
            result = {
                "configured": True,
                "available": True,
                "symbol": symbol,
                "profile": {
                    "name": payload.get("name") or directory["title"],
                    "englishName": payload.get("name") or directory["title"],
                },
                "disclosures": parse_recent_filings(payload),
                "source": "미국 증권거래위원회 SEC EDGAR",
                "asOf": now.isoformat(),
            }
            self._cache[symbol] = (now, result)
            return result


sec_company = SecCompanyService()
