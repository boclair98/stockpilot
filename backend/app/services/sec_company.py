"""Bounded SEC EDGAR reader with shared issuer cache and conservative pacing."""

from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote
from weakref import WeakValueDictionary

import httpx

from app.core.config import settings
from app.core.traffic import TrafficStore, traffic_store

SEC_DATA = "https://data.sec.gov"
SEC_WEB = "https://www.sec.gov"
TICKER_SECONDS = 86400
COMPANY_SECONDS = 900
CACHE_SIZE = 256
# Two starts/sec across replicas, below SEC's aggregate 10/sec ceiling.
SEC_INTERVAL_MS = 500
FILING_FORMS = {"8-K", "10-K", "10-Q", "20-F", "40-F", "6-K"}


class SecAPIError(RuntimeError):
    pass


def retry_after_seconds(value: str) -> float:
    """Honor delta-seconds and HTTP-date; never retry the failed read itself."""
    if re.fullmatch(r"\d{1,9}", value):
        return max(60, int(value))
    try:
        until = parsedate_to_datetime(value)
        if until.tzinfo is None:
            until = until.replace(tzinfo=UTC)
        return max(60, (until - datetime.now(UTC)).total_seconds())
    except (ValueError, TypeError, OverflowError):
        return 60


def parse_ticker_directory(payload: dict) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for row in payload.values():
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("ticker") or "").strip().upper()
        cik = str(row.get("cik_str") or "").strip()
        if (
            re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,11}", ticker)
            and re.fullmatch(r"\d{1,10}", cik)
            and int(cik) > 0
        ):
            result[ticker] = {
                "cik": cik.zfill(10),
                "title": str(row.get("title") or "").strip(),
            }
    return result


def parse_recent_filings(payload: dict) -> list[dict]:
    cik = str(payload.get("cik") or "")
    filings = payload.get("filings")
    recent = filings.get("recent") if isinstance(filings, dict) else None
    if (
        not re.fullmatch(r"\d{1,10}", cik)
        or int(cik) == 0
        or not isinstance(recent, dict)
    ):
        return []

    def field(key: str, index: int) -> str:
        values = recent.get(key)
        if not isinstance(values, list) or index >= len(values):
            return ""
        return values[index] if isinstance(values[index], str) else ""

    forms = recent.get("form")
    if not isinstance(forms, list):
        return []
    rows: list[dict] = []
    for index, form in enumerate(forms):
        if not isinstance(form, str) or form.removesuffix("/A") not in FILING_FORMS:
            continue
        accession = field("accessionNumber", index)
        document = field("primaryDocument", index)
        filing_date = field("filingDate", index)
        if (
            not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", filing_date)
            or not document
            or document.startswith("/")
            or "\\" in document
            or any(part in {"", ".", ".."} for part in document.split("/"))
            or ":" in document
        ):
            continue
        try:
            date.fromisoformat(filing_date)
        except ValueError:
            continue
        rows.append(
            {
                "receiptNo": accession,
                "title": " · ".join(
                    filter(None, (form, field("primaryDocDescription", index)))
                ),
                "date": filing_date.replace("-", ""),
                "submitter": "SEC EDGAR",
                "url": (
                    f"{SEC_WEB}/Archives/edgar/data/{int(cik)}/"
                    f"{accession.replace('-', '')}/{quote(document, safe='/-_.')}"
                ),
            }
        )
        if len(rows) == 8:
            break
    return rows


class SecCompanyService:
    def __init__(
        self,
        *,
        store: TrafficStore | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._store = store if store is not None else traffic_store
        self._transport = transport
        self._cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
        self._locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()

    @property
    def configured(self) -> bool:
        return bool((settings.sec_user_agent or "").strip())

    def _local(self, key: str) -> dict | None:
        cached = self._cache.get(key)
        if cached and cached[0] > time.monotonic():
            self._cache.move_to_end(key)
            return cached[1]
        self._cache.pop(key, None)
        return None

    def _remember(self, key: str, payload: dict, seconds: int) -> dict:
        self._cache[key] = (time.monotonic() + seconds, payload)
        self._cache.move_to_end(key)
        while len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)
        return payload

    async def _cached(
        self,
        key: str,
        seconds: int,
        factory: Callable[[], Awaitable[dict]],
    ) -> dict:
        cached = self._local(key)
        if cached is not None:
            return cached
        lock = self._locks.setdefault(key, asyncio.Lock())
        try:
            # Queue and upstream work are bounded; failed reads are not retried.
            async with asyncio.timeout(12), lock:
                cached = self._local(key)
                if cached is not None:
                    return cached
                if not settings.redis_url:
                    return self._remember(key, await factory(), seconds)
                deadline = time.monotonic() + 8
                while True:
                    shared = await self._store.get_json(key)
                    if isinstance(shared, dict):
                        # Small front cache must not extend Redis's 15m TTL by 15m.
                        return self._remember(key, shared, min(30, seconds))
                    if not self._store.available:
                        raise SecAPIError("공유 공시 캐시를 잠시 사용할 수 없습니다.")
                    token = await self._store.acquire_lock(key, ttl_seconds=30)
                    if token:
                        try:
                            shared = await self._store.get_json(key)
                            if not isinstance(shared, dict):
                                shared = await factory()
                                await self._store.set_json(key, shared, seconds)
                            return self._remember(key, shared, min(30, seconds))
                        finally:
                            await self._store.release_lock(key, token)
                    if time.monotonic() >= deadline:
                        raise SecAPIError("공유 공시 캐시를 잠시 사용할 수 없습니다.")
                    await asyncio.sleep(0.1)
        except TimeoutError as exc:
            raise SecAPIError("공시 조회 대기 시간이 초과되었습니다.") from exc

    async def _get_json(self, url: str) -> dict:
        deadline = time.monotonic() + 3
        while True:
            delay = await self._store.outbound_delay("sec-edgar", SEC_INTERVAL_MS)
            if delay is None:
                raise SecAPIError("공시 요청 제한기를 잠시 사용할 수 없습니다.")
            if not delay:
                break
            if time.monotonic() + delay > deadline:
                raise SecAPIError("공시 제공자의 요청 제한으로 잠시 대기 중입니다.")
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(8, connect=4),
                transport=self._transport,
                headers={
                    "User-Agent": settings.sec_user_agent or "",
                    "Accept": "application/json",
                },
            ) as client:
                response = await client.get(url)
            if response.status_code in {403, 429}:
                retry = response.headers.get("Retry-After", "60")
                await self._store.defer_outbound(
                    "sec-edgar", retry_after_seconds(retry)
                )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SecAPIError("SEC 공시 응답을 확인하지 못했습니다.") from exc
        if not isinstance(payload, dict):
            raise SecAPIError("SEC 응답 형식이 올바르지 않습니다.")
        return payload

    async def company(self, symbol: str) -> dict:
        symbol = symbol.strip().upper()
        base = {"configured": self.configured, "available": False, "symbol": symbol}
        if not self.configured or not re.fullmatch(
            r"[A-Z0-9][A-Z0-9./\-]{0,11}", symbol
        ):
            return base

        async def directory() -> dict:
            rows = parse_ticker_directory(
                await self._get_json(f"{SEC_WEB}/files/company_tickers.json")
            )
            if not rows:
                raise SecAPIError("SEC 종목 목록이 비어 있습니다.")
            return rows

        tickers = await self._cached("sec:v2:tickers", TICKER_SECONDS, directory)
        entry = tickers.get(symbol)
        if entry is None:
            # Normalize only to an entry actually present in the SEC directory.
            entry = tickers.get(symbol.replace("/", "-").replace(".", "-"))
        if entry is None:
            return base
        cik = entry["cik"]

        async def submissions() -> dict:
            payload = await self._get_json(f"{SEC_DATA}/submissions/CIK{cik}.json")
            if str(payload.get("cik") or "").zfill(10) != cik:
                raise SecAPIError("요청한 기업과 공시 응답이 일치하지 않습니다.")
            return {
                "configured": True,
                "available": True,
                "profile": {
                    "name": payload.get("name") or entry["title"],
                    "englishName": payload.get("name") or entry["title"],
                },
                "disclosures": parse_recent_filings(payload),
                "source": "미국 증권거래위원회 SEC EDGAR",
                "asOf": datetime.now(UTC).isoformat(),
            }

        result = await self._cached(
            f"sec:v2:company:{cik}", COMPANY_SECONDS, submissions
        )
        return {**result, "symbol": symbol}


sec_company = SecCompanyService()
