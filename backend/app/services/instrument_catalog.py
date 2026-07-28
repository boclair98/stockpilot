"""Searchable Korean and US stock universe from KIS official master files."""

from __future__ import annotations

import asyncio
import logging
import zipfile
from dataclasses import dataclass
from io import BytesIO

import httpx

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

    @property
    def id(self) -> str:
        return f"{self.market}:{self.exchange}:{self.symbol}"

    def public(self) -> dict:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "name": self.name,
            "englishName": self.english_name,
            "market": self.market,
            "currency": self.currency,
            "exchange": self.exchange,
            "isTop": self.is_top,
        }


TOP_INSTRUMENTS = (
    Instrument("005930", "삼성전자", "KR", "KRW", "KRX", "005930", "Samsung Electronics", True),
    Instrument("000660", "SK하이닉스", "KR", "KRW", "KRX", "000660", "SK hynix", True),
    Instrument("373220", "LG에너지솔루션", "KR", "KRW", "KRX", "373220", "LG Energy Solution", True),
    Instrument("207940", "삼성바이오로직스", "KR", "KRW", "KRX", "207940", "Samsung Biologics", True),
    Instrument("005380", "현대차", "KR", "KRW", "KRX", "005380", "Hyundai Motor", True),
    Instrument("068270", "셀트리온", "KR", "KRW", "KRX", "068270", "Celltrion", True),
    Instrument("105560", "KB금융", "KR", "KRW", "KRX", "105560", "KB Financial", True),
    Instrument("035420", "NAVER", "KR", "KRW", "KRX", "035420", "NAVER", True),
    Instrument("000270", "기아", "KR", "KRW", "KRX", "000270", "Kia", True),
    Instrument("329180", "HD현대중공업", "KR", "KRW", "KRX", "329180", "HD Hyundai Heavy Industries", True),
    Instrument("NVDA", "NVIDIA", "US", "USD", "NAS", "DNASNVDA", "NVIDIA", True),
    Instrument("MSFT", "Microsoft", "US", "USD", "NAS", "DNASMSFT", "Microsoft", True),
    Instrument("AAPL", "Apple", "US", "USD", "NAS", "DNASAAPL", "Apple", True),
    Instrument("AMZN", "Amazon", "US", "USD", "NAS", "DNASAMZN", "Amazon", True),
    Instrument("GOOGL", "Alphabet", "US", "USD", "NAS", "DNASGOOGL", "Alphabet Class A", True),
    Instrument("META", "Meta", "US", "USD", "NAS", "DNASMETA", "Meta Platforms", True),
    Instrument("AVGO", "Broadcom", "US", "USD", "NAS", "DNASAVGO", "Broadcom", True),
    Instrument("TSLA", "Tesla", "US", "USD", "NAS", "DNASTSLA", "Tesla", True),
    Instrument("NFLX", "Netflix", "US", "USD", "NAS", "DNASNFLX", "Netflix", True),
    Instrument("COST", "Costco", "US", "USD", "NAS", "DNASCOST", "Costco Wholesale", True),
)


class InstrumentCatalog:
    def __init__(self) -> None:
        self._items: dict[str, Instrument] = {item.id: item for item in TOP_INSTRUMENTS}
        self._loaded = False
        self._lock = asyncio.Lock()
        self.last_error: str | None = None

    @property
    def count(self) -> int:
        return len(self._items)

    async def ensure_loaded(self) -> None:
        if self._loaded:
            return
        async with self._lock:
            if self._loaded:
                return
            try:
                timeout = httpx.Timeout(25, connect=10)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    responses = await asyncio.gather(
                        *(client.get(url) for url in MASTER_URLS.values()),
                        return_exceptions=True,
                    )
                for exchange, response in zip(MASTER_URLS, responses, strict=True):
                    if isinstance(response, Exception):
                        logger.warning("KIS master download failed (%s): %s", exchange, response)
                        continue
                    response.raise_for_status()
                    raw = self._unzip_first(response.content)
                    parsed = (
                        self._parse_domestic(raw, exchange)
                        if exchange in {"KOSPI", "KOSDAQ"}
                        else self._parse_us(raw, exchange)
                    )
                    for item in parsed:
                        self._items.setdefault(item.id, item)
                self._loaded = len(self._items) > len(TOP_INSTRUMENTS)
                if not self._loaded:
                    self.last_error = "KIS 종목 마스터를 불러오지 못했습니다."
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
        for line in raw.splitlines():
            # The last 228 bytes are fixed-width flags; the name before them
            # is variable-width CP949 text.
            if len(line) <= 249:
                continue
            head = line[:-228]
            code = head[0:9].decode("cp949", errors="ignore").strip()[-6:]
            name = head[21:].decode("cp949", errors="ignore").strip()
            if len(code) == 6 and code.isdigit() and name:
                items.append(
                    Instrument(code, name, "KR", "KRW", "KRX", code, exchange_name)
                )
        return items

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

    async def search(self, query: str, market: str = "ALL", limit: int = 20) -> list[dict]:
        await self.ensure_loaded()
        needle = query.casefold().strip()
        if not needle:
            return []
        matches: list[tuple[int, Instrument]] = []
        for item in self._items.values():
            if market != "ALL" and item.market != market:
                continue
            symbol = item.symbol.casefold()
            name = item.name.casefold()
            english = item.english_name.casefold()
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
        matches.sort(key=lambda row: (row[0], not row[1].is_top, len(row[1].symbol), row[1].name))
        return [item.public() for _, item in matches[:limit]]

    async def get(
        self, symbol: str, market: str | None = None, exchange: str | None = None
    ) -> Instrument | None:
        await self.ensure_loaded()
        symbol = symbol.upper()
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


instrument_catalog = InstrumentCatalog()
