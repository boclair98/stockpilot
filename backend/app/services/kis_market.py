from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

import httpx
import websockets

from app.core.config import settings
from app.services.instrument_catalog import (
    TOP_INSTRUMENTS,
    Instrument,
    instrument_catalog,
)

logger = logging.getLogger(__name__)
TOP_IDS = {item.id for item in TOP_INSTRUMENTS}
MAX_DYNAMIC_SUBSCRIPTIONS = 20
DOMESTIC_REST_MARKET = "UN"
DOMESTIC_STREAM_TR_ID = "H0UNCNT0"

DOMESTIC_COLUMNS = ("symbol", "time", "price", "sign", "change", "change_percent")
OVERSEAS_COLUMNS = (
    "symbol", "decimal_places", "local_date", "korea_date", "local_time",
    "korea_date_2", "korea_time", "open", "high", "low", "price", "sign",
    "change", "change_percent",
)


def _number(value: object, default: Decimal = Decimal("0")) -> Decimal:
    try:
        return Decimal(str(value or "0").replace(",", ""))
    except (InvalidOperation, ValueError):
        return default


class KISMarket:
    def __init__(self) -> None:
        self._quotes: dict[str, dict] = {}
        self._watched: OrderedDict[str, Instrument] = OrderedDict(
            (item.id, item) for item in TOP_INSTRUMENTS
        )
        self._dynamic: OrderedDict[str, Instrument] = OrderedDict()
        self._access_token: str | None = None
        self._access_expires_at = 0.0
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._socket = None
        self._send_lock = asyncio.Lock()
        self._rest_lock = asyncio.Lock()
        self._last_rest_call = 0.0
        self._news_cache: dict[str, tuple[datetime, list[dict]]] = {}
        self._history_cache: dict[str, tuple[datetime, list[dict]]] = {}
        self.connected = False
        self.last_error: str | None = None

    @property
    def configured(self) -> bool:
        return bool(settings.kis_app_key and settings.kis_app_secret)

    @property
    def rest_base(self) -> str:
        return (
            "https://openapi.koreainvestment.com:9443"
            if settings.kis_env == "real"
            else "https://openapivts.koreainvestment.com:29443"
        )

    @property
    def ws_url(self) -> str:
        return (
            "ws://ops.koreainvestment.com:21000"
            if settings.kis_env == "real"
            else "ws://ops.koreainvestment.com:31000"
        )

    def start(self) -> None:
        if self.configured and (self._task is None or self._task.done()):
            self._stop.clear()
            self._task = asyncio.create_task(self._run(), name="kis-market-stream")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        self._task = None

    def snapshot(self, *, top_only: bool = False) -> list[dict]:
        instruments = TOP_INSTRUMENTS if top_only else self._watched.values()
        return [
            self._quotes[item.id].copy()
            for item in instruments
            if item.id in self._quotes
        ]

    def quote(
        self, symbol: str, market: str | None = None, exchange: str | None = None
    ) -> dict | None:
        instrument = instrument_catalog.get_cached(symbol, market, exchange)
        if not instrument:
            return None
        quote = self._quotes.get(instrument.id)
        return quote.copy() if quote else None

    def status(self) -> dict:
        return {
            "configured": self.configured,
            "connected": self.connected,
            "source": "한국투자증권 KIS Open API",
            "domesticVenue": "KRX+NXT 통합",
            "domesticMarketCode": DOMESTIC_REST_MARKET,
            "quoteCount": len(self._quotes),
            "catalogCount": instrument_catalog.count,
            "lastError": self.last_error or instrument_catalog.last_error,
        }

    async def fetch_quote(self, instrument: Instrument) -> dict | None:
        await self.watch(instrument)
        cached = self._quotes.get(instrument.id)
        if cached:
            try:
                age = datetime.now(UTC) - datetime.fromisoformat(cached["asOf"])
                if age.total_seconds() < 5:
                    return cached.copy()
            except (KeyError, ValueError):
                pass
        await self._fetch_rest(instrument)
        cached = self._quotes.get(instrument.id)
        return cached.copy() if cached else None

    async def watch(self, instrument: Instrument) -> None:
        if instrument.id in self._watched:
            if instrument.id in self._dynamic:
                self._dynamic.move_to_end(instrument.id)
            return
        if len(self._dynamic) >= MAX_DYNAMIC_SUBSCRIPTIONS:
            old_id, old = self._dynamic.popitem(last=False)
            self._watched.pop(old_id, None)
            if self._socket:
                await self._send_subscription(old, "2")
        self._dynamic[instrument.id] = instrument
        self._watched[instrument.id] = instrument
        if self._socket:
            await self._send_subscription(instrument, "1")

    async def news_titles(self, instrument: Instrument) -> list[dict]:
        cached = self._news_cache.get(instrument.id)
        now = datetime.now(UTC)
        if cached and (now - cached[0]).total_seconds() < 300:
            return [item.copy() for item in cached[1]]
        if not self.configured:
            return []

        try:
            async with self._rest_lock:
                await self._rate_limit_rest()
                token = await self._token()
                async with httpx.AsyncClient(timeout=12) as client:
                    if instrument.market == "KR":
                        response = await client.get(
                            (
                                f"{self.rest_base}/uapi/domestic-stock/v1/"
                                "quotations/news-title"
                            ),
                            headers=self._headers(token, "FHKST01011800"),
                            params={
                                "FID_NEWS_OFER_ENTP_CODE": "",
                                "FID_COND_MRKT_CLS_CODE": "",
                                "FID_INPUT_ISCD": instrument.symbol,
                                "FID_TITL_CNTT": "",
                                "FID_INPUT_DATE_1": "",
                                "FID_INPUT_HOUR_1": "",
                                "FID_RANK_SORT_CLS_CODE": "",
                                "FID_INPUT_SRNO": "",
                            },
                        )
                        payload = response.json()
                        rows = payload.get("output") or payload.get("output1") or []
                        result = [
                            {
                                "id": (
                                    row.get("cntt_usiq_srno")
                                    or f"{row.get('data_dt')}:{row.get('data_tm')}"
                                ),
                                "title": row.get("hts_pbnt_titl_cntt"),
                                "source": row.get("dorg") or "KIS",
                                "date": row.get("data_dt"),
                                "time": row.get("data_tm"),
                            }
                            for row in rows
                            if row.get("hts_pbnt_titl_cntt")
                        ]
                    else:
                        response = await client.get(
                            (
                                f"{self.rest_base}/uapi/overseas-price/v1/"
                                "quotations/news-title"
                            ),
                            headers=self._headers(token, "HHPSTH60100C1"),
                            params={
                                "INFO_GB": "",
                                "CLASS_CD": "",
                                "NATION_CD": "US",
                                "EXCHANGE_CD": instrument.exchange,
                                "SYMB": instrument.symbol,
                                "DATA_DT": "",
                                "DATA_TM": "",
                                "CTS": "",
                            },
                        )
                        payload = response.json()
                        rows = payload.get("outblock1") or []
                        result = [
                            {
                                "id": (
                                    row.get("news_key")
                                    or f"{row.get('data_dt')}:{row.get('data_tm')}"
                                ),
                                "title": row.get("title"),
                                "source": row.get("source") or "KIS",
                                "date": row.get("data_dt"),
                                "time": row.get("data_tm"),
                            }
                            for row in rows
                            if row.get("title")
                            and (
                                not row.get("symb")
                                or row.get("symb") == instrument.symbol
                            )
                        ]
            self._news_cache[instrument.id] = (now, result[:12])
            return [item.copy() for item in result[:12]]
        except Exception as exc:
            logger.info("KIS news unavailable for %s: %s", instrument.id, exc)
            return []

    async def daily_history(self, instrument: Instrument) -> list[dict]:
        cached = self._history_cache.get(instrument.id)
        now = datetime.now(UTC)
        if cached and (now - cached[0]).total_seconds() < 3600:
            return [item.copy() for item in cached[1]]
        if not self.configured:
            return []

        end = now.date() - timedelta(days=7)
        start = end - timedelta(days=150)
        try:
            async with self._rest_lock:
                await self._rate_limit_rest()
                token = await self._token()
                async with httpx.AsyncClient(timeout=15) as client:
                    if instrument.market == "KR":
                        response = await client.get(
                            (
                                f"{self.rest_base}/uapi/domestic-stock/v1/"
                                "quotations/inquire-daily-itemchartprice"
                            ),
                            headers=self._headers(token, "FHKST03010100"),
                            params={
                                "FID_COND_MRKT_DIV_CODE": DOMESTIC_REST_MARKET,
                                "FID_INPUT_ISCD": instrument.symbol,
                                "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
                                "FID_INPUT_DATE_2": end.strftime("%Y%m%d"),
                                "FID_PERIOD_DIV_CODE": "D",
                                "FID_ORG_ADJ_PRC": "0",
                            },
                        )
                        payload = response.json()
                        rows = payload.get("output2") or []
                        result = [
                            {
                                "date": row.get("stck_bsop_date"),
                                "open": float(_number(row.get("stck_oprc"))),
                                "high": float(_number(row.get("stck_hgpr"))),
                                "low": float(_number(row.get("stck_lwpr"))),
                                "close": float(_number(row.get("stck_clpr"))),
                                "volume": float(_number(row.get("acml_vol"))),
                            }
                            for row in rows
                            if row.get("stck_bsop_date") and row.get("stck_clpr")
                        ]
                    else:
                        response = await client.get(
                            (
                                f"{self.rest_base}/uapi/overseas-price/v1/"
                                "quotations/dailyprice"
                            ),
                            headers=self._headers(token, "HHDFS76240000"),
                            params={
                                "AUTH": "",
                                "EXCD": instrument.exchange,
                                "SYMB": instrument.symbol,
                                "GUBN": "0",
                                "BYMD": end.strftime("%Y%m%d"),
                                "MODP": "1",
                            },
                        )
                        payload = response.json()
                        rows = payload.get("output2") or []
                        result = [
                            {
                                "date": row.get("xymd"),
                                "open": float(_number(row.get("open"))),
                                "high": float(_number(row.get("high"))),
                                "low": float(_number(row.get("low"))),
                                "close": float(_number(row.get("clos"))),
                                "volume": float(_number(row.get("tvol"))),
                            }
                            for row in rows
                            if row.get("xymd") and row.get("clos")
                        ]
            result = [item for item in result if item["close"] > 0]
            result.sort(key=lambda item: item["date"])
            self._history_cache[instrument.id] = (now, result[-80:])
            return [item.copy() for item in result[-80:]]
        except Exception as exc:
            logger.info("KIS history unavailable for %s: %s", instrument.id, exc)
            return []

    async def _run(self) -> None:
        retry = 2
        while not self._stop.is_set():
            seed_task = None
            try:
                seed_task = asyncio.create_task(self._seed_quotes())
                await self._stream()
                retry = 2
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.connected = False
                self.last_error = str(exc)[:240]
                logger.warning("KIS stream disconnected: %s", self.last_error)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=retry)
                except TimeoutError:
                    pass
                retry = min(retry * 2, 30)
            finally:
                if seed_task:
                    seed_task.cancel()
                    await asyncio.gather(seed_task, return_exceptions=True)

    async def _token(self) -> str:
        now = datetime.now(UTC).timestamp()
        if self._access_token and now < self._access_expires_at - 60:
            return self._access_token
        payload = {
            "grant_type": "client_credentials",
            "appkey": settings.kis_app_key,
            "appsecret": settings.kis_app_secret,
        }
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(f"{self.rest_base}/oauth2/tokenP", json=payload)
            response.raise_for_status()
            data = response.json()
        self._access_token = data["access_token"]
        self._access_expires_at = now + int(data.get("expires_in", 86400))
        return self._access_token

    async def _approval_key(self) -> str:
        payload = {
            "grant_type": "client_credentials",
            "appkey": settings.kis_app_key,
            "secretkey": settings.kis_app_secret,
        }
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{self.rest_base}/oauth2/Approval", json=payload
            )
            response.raise_for_status()
            return response.json()["approval_key"]

    def _headers(self, token: str, tr_id: str) -> dict[str, str]:
        return {
            "authorization": f"Bearer {token}",
            "appkey": settings.kis_app_key or "",
            "appsecret": settings.kis_app_secret or "",
            "tr_id": tr_id,
            "custtype": "P",
        }

    async def _rate_limit_rest(self) -> None:
        if settings.kis_env == "real":
            return
        now = asyncio.get_running_loop().time()
        wait = 1.05 - (now - self._last_rest_call)
        if wait > 0:
            await asyncio.sleep(wait)
        self._last_rest_call = asyncio.get_running_loop().time()

    async def _fetch_rest(self, instrument: Instrument) -> None:
        async with self._rest_lock:
            await self._rate_limit_rest()
            token = await self._token()
            async with httpx.AsyncClient(timeout=12) as client:
                if instrument.market == "KR":
                    response = await client.get(
                        f"{self.rest_base}/uapi/domestic-stock/v1/quotations/inquire-price",
                        headers=self._headers(token, "FHKST01010100"),
                        params={
                            "FID_COND_MRKT_DIV_CODE": DOMESTIC_REST_MARKET,
                            "FID_INPUT_ISCD": instrument.symbol,
                        },
                    )
                    data = response.json()
                    if response.is_success and data.get("rt_cd") == "0":
                        output = data["output"]
                        self._store(
                            instrument,
                            output.get("stck_prpr"),
                            output.get("prdy_vrss"),
                            output.get("prdy_ctrt"),
                            "REST",
                        )
                else:
                    response = await client.get(
                        f"{self.rest_base}/uapi/overseas-price/v1/quotations/price",
                        headers=self._headers(token, "HHDFS00000300"),
                        params={
                            "AUTH": "",
                            "EXCD": instrument.exchange,
                            "SYMB": instrument.symbol,
                        },
                    )
                    data = response.json()
                    if response.is_success and data.get("rt_cd") == "0":
                        output = data["output"]
                        self._store(
                            instrument,
                            output.get("last"),
                            output.get("diff"),
                            output.get("rate"),
                            "REST",
                        )

    async def _seed_quotes(self) -> None:
        for instrument in TOP_INSTRUMENTS:
            if self._stop.is_set():
                return
            try:
                await self._fetch_rest(instrument)
            except Exception as exc:
                logger.info("KIS seed failed for %s: %s", instrument.symbol, exc)

    async def _send_subscription(self, instrument: Instrument, tr_type: str) -> None:
        if not self._socket:
            return
        tr_id = DOMESTIC_STREAM_TR_ID if instrument.market == "KR" else "HDFSCNT0"
        message = {
            "header": {
                "approval_key": self._approval,
                "custtype": "P",
                "tr_type": tr_type,
                "content-type": "utf-8",
            },
            "body": {"input": {"tr_id": tr_id, "tr_key": instrument.ws_key}},
        }
        async with self._send_lock:
            await self._socket.send(json.dumps(message))
            await asyncio.sleep(0.5 if settings.kis_env != "real" else 0.1)

    async def _stream(self) -> None:
        self._approval = await self._approval_key()
        async with websockets.connect(
            self.ws_url, ping_interval=20, ping_timeout=20, close_timeout=5
        ) as socket:
            self._socket = socket
            try:
                for instrument in tuple(self._watched.values()):
                    await self._send_subscription(instrument, "1")
                self.connected = True
                self.last_error = None
                async for raw in socket:
                    if self._stop.is_set():
                        return
                    if raw.startswith(("0|", "1|")):
                        self._consume_tick(raw)
                        continue
                    try:
                        system = json.loads(raw)
                        if system.get("header", {}).get("tr_id") == "PINGPONG":
                            await socket.pong(raw.encode())
                        elif system.get("body", {}).get("rt_cd") not in (None, "0"):
                            logger.info("KIS subscription message: %s", system["body"])
                    except json.JSONDecodeError:
                        logger.debug("Ignored malformed KIS message")
            finally:
                self._socket = None
                self.connected = False

    def _consume_tick(self, raw: str) -> None:
        parts = raw.split("|", 3)
        if len(parts) != 4:
            return
        tr_id, values = parts[1], parts[3].split("^")
        if tr_id in {
            DOMESTIC_STREAM_TR_ID,
            "H0NXCNT0",
            "H0STCNT0",
        } and len(values) >= len(DOMESTIC_COLUMNS):
            instrument = next(
                (item for item in self._watched.values() if item.market == "KR" and item.symbol == values[0]),
                None,
            )
            if instrument:
                self._store(instrument, values[2], values[4], values[5], "WebSocket")
        elif tr_id == "HDFSCNT0" and len(values) >= len(OVERSEAS_COLUMNS):
            instrument = next(
                (item for item in self._watched.values() if item.market == "US" and item.symbol == values[0]),
                None,
            )
            if instrument:
                self._store(instrument, values[10], values[12], values[13], "WebSocket")

    def _store(
        self,
        instrument: Instrument,
        price_value: object,
        change_value: object,
        percent_value: object,
        transport: str,
    ) -> None:
        price = _number(price_value)
        if price <= 0:
            return
        venue = "KRX+NXT 통합" if instrument.market == "KR" else "미국 현지시장"
        self._quotes[instrument.id] = {
            **instrument.public(),
            "price": float(price),
            "change": float(_number(change_value)),
            "changePercent": float(_number(percent_value)),
            "marketState": "LIVE" if transport == "WebSocket" else "SNAPSHOT",
            "asOf": datetime.now(UTC).isoformat(),
            "venue": venue,
            "source": f"KIS {venue} · {transport}",
        }


kis_market = KISMarket()
