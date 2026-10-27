"""Searchable Korean and US stock universe from KIS official master files."""

from __future__ import annotations

import asyncio
import hashlib
import heapq
import logging
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from urllib.parse import quote

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

MASTER_URLS = {
    "KOSPI": "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip",
    "KOSDAQ": "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip",
    "NAS": "https://new.real.download.dws.co.kr/common/master/nasmst.cod.zip",
    "NYS": "https://new.real.download.dws.co.kr/common/master/nysmst.cod.zip",
    "AMS": "https://new.real.download.dws.co.kr/common/master/amsmst.cod.zip",
}


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    market: str
    currency: str
    exchange: str
    ws_key: str
    english_name: str = ""
    is_top: bool = False
    listing_market: str = ""

    @property
    def id(self) -> str:
        return f"{self.market}:{self.exchange}:{self.symbol}"

    def public(self) -> dict:
        logo_url = None
        if settings.logo_dev_publishable_key:
            ticker = self.symbol
            if self.market == "KR":
                suffix = "KQ" if self.listing_market == "KOSDAQ" else "KS"
                ticker = f"{self.symbol}.{suffix}"
            logo_url = (
                f"https://img.logo.dev/ticker/{quote(ticker, safe='')}"
                f"?token={quote(settings.logo_dev_publishable_key, safe='_-')}"
                # Let Logo.dev return its built-in monogram for an unmapped
                # ticker instead of a 404/broken image in stock lists.
                "&size=96&format=webp&retina=true"
            )
        return {
            "id": self.id,
            "symbol": self.symbol,
            "name": self.name,
            "englishName": self.english_name,
            "market": self.market,
            "currency": self.currency,
            "exchange": self.exchange,
            "listingMarket": self.listing_market
            or ("KOSPI" if self.is_top and self.market == "KR" else ""),
            "isTop": self.is_top,
            "logoUrl": logo_url,
        }


TOP_INSTRUMENTS = (
    Instrument(
        "005930", "삼성전자", "KR", "KRW", "KRX", "005930", "Samsung Electronics", True
    ),
    Instrument("000660", "SK하이닉스", "KR", "KRW", "KRX", "000660", "SK hynix", True),
    Instrument(
        "373220",
        "LG에너지솔루션",
        "KR",
        "KRW",
        "KRX",
        "373220",
        "LG Energy Solution",
        True,
    ),
    Instrument(
        "207940",
        "삼성바이오로직스",
        "KR",
        "KRW",
        "KRX",
        "207940",
        "Samsung Biologics",
        True,
    ),
    Instrument("005380", "현대차", "KR", "KRW", "KRX", "005380", "Hyundai Motor", True),
    Instrument("068270", "셀트리온", "KR", "KRW", "KRX", "068270", "Celltrion", True),
    Instrument("105560", "KB금융", "KR", "KRW", "KRX", "105560", "KB Financial", True),
    Instrument("035420", "NAVER", "KR", "KRW", "KRX", "035420", "NAVER", True),
    Instrument("000270", "기아", "KR", "KRW", "KRX", "000270", "Kia", True),
    Instrument(
        "329180",
        "HD현대중공업",
        "KR",
        "KRW",
        "KRX",
        "329180",
        "HD Hyundai Heavy Industries",
        True,
    ),
    Instrument("NVDA", "NVIDIA", "US", "USD", "NAS", "DNASNVDA", "NVIDIA", True),
    Instrument("MSFT", "Microsoft", "US", "USD", "NAS", "DNASMSFT", "Microsoft", True),
    Instrument("AAPL", "Apple", "US", "USD", "NAS", "DNASAAPL", "Apple", True),
    Instrument("AMZN", "Amazon", "US", "USD", "NAS", "DNASAMZN", "Amazon", True),
    Instrument(
        "GOOGL", "Alphabet", "US", "USD", "NAS", "DNASGOOGL", "Alphabet Class A", True
    ),
    Instrument("META", "Meta", "US", "USD", "NAS", "DNASMETA", "Meta Platforms", True),
    Instrument("AVGO", "Broadcom", "US", "USD", "NAS", "DNASAVGO", "Broadcom", True),
    Instrument("TSLA", "Tesla", "US", "USD", "NAS", "DNASTSLA", "Tesla", True),
    Instrument("NFLX", "Netflix", "US", "USD", "NAS", "DNASNFLX", "Netflix", True),
    Instrument(
        "COST", "Costco", "US", "USD", "NAS", "DNASCOST", "Costco Wholesale", True
    ),
)


class InstrumentCatalog:
    def __init__(self) -> None:
        self._items: dict[str, Instrument] = {}
        # Symbol lookups are on the hot path for quotes, orders, alerts, and
        # every dashboard request. Keep the full catalog for search, but use a
        # normalized composite index for exact lookups instead of scanning all
        # tens of thousands of KRX/NXT/US rows.
        self._by_key: dict[tuple[str, str, str], Instrument] = {}
        self._search_rows: dict[str, tuple[Instrument, str, str, str]] = {}
        self._page_rows: dict[tuple[str, str], list[Instrument]] = {}
        self._loaded_exchanges: set[str] = set()
        self._loaded_at: dict[str, str] = {}
        self._directory_versions: dict[tuple[str, str], str] = {}
        for item in TOP_INSTRUMENTS:
            self._add(item)
        self._loaded = False
        self._lock = asyncio.Lock()
        self.last_error: str | None = None

    def _add(self, item: Instrument) -> None:
        """Insert an instrument while preserving curated top-row metadata."""

        if item.id in self._items:
            return
        self._items[item.id] = item
        self._by_key.setdefault(
            (item.symbol.upper(), item.market.upper(), item.exchange.upper()), item
        )
        self._search_rows[item.id] = (
            item,
            item.symbol.casefold(),
            item.name.casefold(),
            item.english_name.casefold(),
        )
        self._page_rows.clear()
        self._directory_versions.clear()

    @property
    def count(self) -> int:
        return len(self._items)

    async def ensure_loaded(self) -> None:
        if self._loaded_exchanges == set(MASTER_URLS):
            return
        async with self._lock:
            missing = [
                exchange
                for exchange in MASTER_URLS
                if exchange not in self._loaded_exchanges
            ]
            if not missing:
                return
            try:
                timeout = httpx.Timeout(25, connect=10)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    responses = await asyncio.gather(
                        *(client.get(MASTER_URLS[exchange]) for exchange in missing),
                        return_exceptions=True,
                    )
                for exchange, response in zip(missing, responses, strict=True):
                    if isinstance(response, Exception):
                        logger.warning(
                            "KIS master download failed (%s): %s", exchange, response
                        )
                        continue
                    response.raise_for_status()
                    raw = self._unzip_first(response.content)
                    parsed = (
                        self._parse_domestic(raw, exchange)
                        if exchange in {"KOSPI", "KOSDAQ"}
                        else self._parse_us(raw, exchange)
                    )
                    if not parsed:
                        logger.warning(
                            "KIS master contained no instruments (%s)", exchange
                        )
                        continue
                    for item in parsed:
                        self._add(item)
                    self._loaded_exchanges.add(exchange)
                    self._loaded_at[exchange] = datetime.now(UTC).isoformat()
                self._loaded = self._loaded_exchanges == set(MASTER_URLS)
                if not self._loaded:
                    self.last_error = "일부 KIS 종목 마스터를 불러오지 못했습니다."
                else:
                    self.last_error = None
            except Exception as exc:
                self.last_error = str(exc)[:240]
                logger.warning("KIS master load failed: %s", self.last_error)

    @staticmethod
    def _unzip_first(content: bytes) -> bytes:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            return archive.read(archive.namelist()[0])

    @staticmethod
    def _parse_domestic(raw: bytes, exchange_name: str) -> list[Instrument]:
        items = []
        # Official KIS parsers count the LF terminator in 228/222 characters.
        # splitlines removes that terminator; KOSPI has 227 trailing fields,
        # KOSDAQ 221. Decode first so a Korean name cannot be cut mid-character.
        flag_width = 221 if exchange_name == "KOSDAQ" else 227
        for line in raw.decode("cp949", errors="replace").splitlines():
            if len(line) <= 21 + flag_width:
                continue
            head = line[:-flag_width]
            code = head[:9].strip().upper()
            name = head[21:].strip()
            # Six-character listed codes may contain letters. Never truncate
            # a nine-character fund identifier into a different stock identity.
            if (
                len(code) == 6
                and code.isascii()
                and code.isalnum()
                and name
                and "\ufffd" not in name
            ):
                items.append(
                    Instrument(
                        code,
                        name,
                        "KR",
                        "KRW",
                        "KRX",
                        code,
                        listing_market=exchange_name,
                    )
                )
        return items

    def _listing_rows(self, market: str, exchange: str) -> list[Instrument]:
        key = (market, exchange)
        if key not in self._page_rows:
            unique = {}
            for item in self._items.values():
                if item.market != market or (market == "KR" and item.exchange != "KRX"):
                    continue
                listing = item.listing_market or (
                    "KOSPI" if item.is_top and market == "KR" else ""
                )
                if (
                    exchange != "ALL"
                    and (listing if market == "KR" else item.exchange) != exchange
                ):
                    continue
                unique.setdefault((item.exchange, item.symbol), item)
            self._page_rows[key] = sorted(
                unique.values(), key=lambda item: (item.symbol, item.exchange)
            )
        return self._page_rows[key]

    @staticmethod
    def _required_exchanges(market: str, exchange: str) -> set[str]:
        return (
            ({"KOSPI", "KOSDAQ"} if market == "KR" else {"NAS", "NYS", "AMS"})
            if exchange == "ALL"
            else {exchange}
        )

    async def directory(
        self, market: str, exchange: str, query: str, offset: int, limit: int
    ) -> dict:
        """Web directory: whole-universe search, bounded pages, no quote fanout.

        Versions bind navigation to actual catalog content, not request time.
        Searching scans the local index only; user queries are never cached.
        """
        await self.ensure_loaded()
        rows = self._listing_rows(market, exchange)
        key = (market, exchange)
        if key not in self._directory_versions:
            digest = hashlib.sha256()
            for item in rows:
                digest.update(f"{item.id}\0{item.name}\0{item.english_name}\n".encode())
            self._directory_versions[key] = digest.hexdigest()[:24]
        needle = query.strip().casefold()
        matches = rows
        if needle:
            matches = [
                item
                for item in rows
                if any(needle in value for value in self._search_rows[item.id][1:])
            ]
            # Exact ticker first, then name/ticker prefix. Stable identity tie-break.
            matches.sort(
                key=lambda item: (
                    0
                    if needle == item.symbol.casefold()
                    else 1
                    if item.symbol.casefold().startswith(needle)
                    else 2
                    if item.name.casefold().startswith(needle)
                    or item.english_name.casefold().startswith(needle)
                    else 3,
                    item.symbol,
                    item.exchange,
                )
            )
        required = self._required_exchanges(market, exchange)
        complete = required.issubset(self._loaded_exchanges)
        return {
            "items": [item.public() for item in matches[offset : offset + limit]],
            "total": len(matches),
            "universeTotal": len(rows),
            "offset": offset,
            "limit": limit,
            "query": query.strip(),
            "market": market,
            "exchange": exchange,
            "hasMore": offset + limit < len(matches),
            "partial": not complete,
            "snapshot": self._directory_versions[key],
            "coverage": [
                {
                    "exchange": name,
                    "available": name in self._loaded_exchanges,
                    "loadedAt": self._loaded_at.get(name),
                }
                for name in sorted(required)
            ],
            "basis": "종목코드순 · 검색 시 일치도순",
        }

    @staticmethod
    def _parse_us(raw: bytes, exchange: str) -> list[Instrument]:
        items = []
        for line in raw.decode("cp949", errors="ignore").splitlines():
            fields = line.split("\t")
            if len(fields) < 10 or fields[8].strip() not in {"2", "3"}:
                continue
            symbol = fields[4].strip().upper()
            realtime_symbol = fields[5].strip()
            korean_name = fields[6].strip()
            english_name = fields[7].strip()
            if symbol and (korean_name or english_name):
                items.append(
                    Instrument(
                        symbol,
                        korean_name or english_name,
                        "US",
                        "USD",
                        exchange,
                        f"D{realtime_symbol}",
                        english_name,
                    )
                )
        return items

    async def page(self, market: str, exchange: str, offset: int, limit: int) -> dict:
        """Paginate the official catalog without fetching thousands of quotes."""
        await self.ensure_loaded()
        rows = self._listing_rows(market, exchange)
        required = self._required_exchanges(market, exchange)
        partial = not required.issubset(self._loaded_exchanges)
        has_more = not partial and offset + limit < len(rows)
        return {
            "items": [item.public() for item in rows[offset : offset + limit]],
            "total": len(rows),
            "partial": partial,
            "hasMore": has_more,
            "nextOffset": offset + limit if has_more else None,
        }

    async def search(
        self, query: str, market: str = "ALL", limit: int = 20
    ) -> list[dict]:
        await self.ensure_loaded()
        needle = query.casefold().strip()
        if not needle:
            return []
        matches: list[tuple[int, Instrument]] = []
        for item, symbol, name, english in self._search_rows.values():
            if market != "ALL" and item.market != market:
                continue
            if needle == symbol:
                score = 0
            elif symbol.startswith(needle):
                score = 1
            elif name.startswith(needle) or english.startswith(needle):
                score = 2
            elif needle in symbol or needle in name or needle in english:
                score = 3
            else:
                continue
            matches.append((score, item))
        best_matches = heapq.nsmallest(
            limit,
            matches,
            key=lambda row: (
                row[0],
                not row[1].is_top,
                len(row[1].symbol),
                row[1].name,
            ),
        )
        return [item.public() for _, item in best_matches]

    async def get(
        self, symbol: str, market: str | None = None, exchange: str | None = None
    ) -> Instrument | None:
        await self.ensure_loaded()
        symbol = symbol.upper()
        market = market.upper() if market else None
        exchange = exchange.upper() if exchange else None
        if market and exchange:
            return self._by_key.get((symbol, market, exchange))
        for item in self._items.values():
            if (
                item.symbol == symbol
                and (not market or item.market == market)
                and (not exchange or item.exchange == exchange)
            ):
                return item
        return None

    def get_cached(
        self, symbol: str, market: str | None = None, exchange: str | None = None
    ) -> Instrument | None:
        symbol = symbol.upper()
        market = market.upper() if market else None
        exchange = exchange.upper() if exchange else None
        if market and exchange:
            return self._by_key.get((symbol, market, exchange))
        return next(
            (
                item
                for item in self._items.values()
                if item.symbol == symbol
                and (not market or item.market == market)
                and (not exchange or item.exchange == exchange)
            ),
            None,
        )

    def matching_names_cached(
        self, query: str, market: str | None = None
    ) -> list[tuple[str, str]]:
        """Local-only name matching for history; never waits on quote/master APIs.

        History may contain delisted/unknown symbols, which remain searchable by
        code in the database. The application warms this catalog in the background.
        """
        needle = query.casefold().strip()
        if not needle:
            return []
        keys = set()
        for item, _, name, english in self._search_rows.values():
            if market and item.market != market:
                continue
            if needle in name or needle in english:
                keys.add((item.exchange, item.symbol))
                if item.market == "KR" and item.exchange == "KRX":
                    keys.add(("NXT", item.symbol))
        return sorted(keys)


instrument_catalog = InstrumentCatalog()
