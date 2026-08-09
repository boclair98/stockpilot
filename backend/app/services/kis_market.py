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
from app.core.traffic import traffic_store
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
    "symbol",
    "decimal_places",
    "local_date",
    "korea_date",
    "local_time",
    "korea_date_2",
    "korea_time",
    "open",
    "high",
    "low",
    "price",
    "sign",
    "change",
    "change_percent",
)


def _number(value: object, default: Decimal = Decimal("0")) -> Decimal:
    try:
        return Decimal(str(value or "0").replace(",", ""))
    except (InvalidOperation, ValueError):
        return default


def parse_kospi_payload(payload: dict, now: datetime | None = None) -> dict:
    """Normalize KIS daily index output for the public chart API."""
    output = payload.get("output1") or {}
    rows = payload.get("output2") or []
    points = [
        {
            "date": (
                f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
                if len(date := str(row.get("stck_bsop_date") or "")) == 8
                else date
            ),
            "open": float(_number(row.get("bstp_nmix_oprc"))),
            "high": float(_number(row.get("bstp_nmix_hgpr"))),
            "low": float(_number(row.get("bstp_nmix_lwpr"))),
            "close": float(_number(row.get("bstp_nmix_prpr"))),
            "volume": float(_number(row.get("acml_vol"))),
        }
        for row in rows
        if row.get("stck_bsop_date") and _number(row.get("bstp_nmix_prpr")) > 0
    ]
    points.sort(key=lambda item: item["date"])
    points = points[-30:]
    value = float(_number(output.get("bstp_nmix_prpr")))
    if value <= 0 and points:
        value = points[-1]["close"]
    return {
        "name": "KOSPI",
        "marketName": output.get("hts_kor_isnm") or "코스피",
        "value": value,
        "change": float(_number(output.get("bstp_nmix_prdy_vrss"))),
        "changePercent": float(_number(output.get("bstp_nmix_prdy_ctrt"))),
        "previousClose": float(_number(output.get("prdy_nmix"))),
        "asOf": (now or datetime.now(UTC)).isoformat(),
        "source": "한국투자증권 KIS Open API",
        "points": points,
    }


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
        self._snapshot_task: asyncio.Task | None = None
        self._http: httpx.AsyncClient | None = None
        self._socket = None
        self._send_lock = asyncio.Lock()
        self._rest_lock = asyncio.Lock()
        self._last_rest_call = 0.0
        self._news_cache: dict[str, tuple[datetime, list[dict]]] = {}
        self._history_cache: dict[str, tuple[datetime, list[dict]]] = {}
        self._index_cache: tuple[datetime, dict] | None = None
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
            if self._http is None:
                self._http = httpx.AsyncClient(
                    timeout=httpx.Timeout(15, connect=5),
                    limits=httpx.Limits(max_connections=30, max_keepalive_connections=15),
                )
            self._task = asyncio.create_task(self._run(), name="kis-market-stream")
            self._snapshot_task = asyncio.create_task(
                self._persist_snapshots(), name="kis-market-snapshot"
            )

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self._snapshot_task:
            self._snapshot_task.cancel()
            await asyncio.gather(self._snapshot_task, return_exceptions=True)
        self._task = None
        self._snapshot_task = None
        if self._http:
            await self._http.aclose()
            self._http = None

    def snapshot(self, *, top_only: bool = False) -> list[dict]:
        instruments = TOP_INSTRUMENTS if top_only else self._watched.values()
        return [
            self._quotes[item.id].copy()
            for item in instruments
            if item.id in self._quotes
        ]

    async def shared_snapshot(self, *, top_only: bool = False) -> list[dict]:
        """Return local ticks or restore the last healthy snapshot from Redis."""
        local = self.snapshot(top_only=top_only)
        if local:
            return local
        cached = await traffic_store.get_json("market:quotes:top")
        if not isinstance(cached, list):
            return []
        for row in cached:
            if isinstance(row, dict) and row.get("id"):
                self._quotes[str(row["id"])] = row.copy()
        return self.snapshot(top_only=top_only)

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(15, connect=5),
                limits=httpx.Limits(max_connections=30, max_keepalive_connections=15),
            )
        return self._http

    async def _persist_snapshots(self) -> None:
        while not self._stop.is_set():
            rows = self.snapshot(top_only=True)
            if rows:
                await traffic_store.set_json("market:quotes:top", rows, 300)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=2)
            except TimeoutError:
                pass

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
        cache_key = f"market:quote:{instrument.id}"

        async def refresh() -> dict | None:
            await self._fetch_rest(instrument)
            fresh = self._quotes.get(instrument.id)
            return fresh.copy() if fresh else None

        shared = await traffic_store.get_or_set(cache_key, 5, refresh)
        if shared:
            self._quotes[instrument.id] = shared
            return shared.copy()
        return None

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
        shared = await traffic_store.get_json(f"market:news:{instrument.id}")
        if shared:
            self._news_cache[instrument.id] = (now, shared)
            return [item.copy() for item in shared]
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
            await traffic_store.set_json(
                f"market:news:{instrument.id}", result[:12], 300
            )
            return [item.copy() for item in result[:12]]
        except Exception as exc:
            logger.info("KIS news unavailable for %s: %s", instrument.id, exc)
            return []

    async def daily_history(self, instrument: Instrument) -> list[dict]:
        cached = self._history_cache.get(instrument.id)
        now = datetime.now(UTC)
        if cached and (now - cached[0]).total_seconds() < 3600:
            return [item.copy() for item in cached[1]]
        shared = await traffic_store.get_json(f"market:history:{instrument.id}")
        if shared:
            self._history_cache[instrument.id] = (now, shared)
            return [item.copy() for item in shared]
        if not self.configured:
            return []

        # KIS rejects a range ending on a not-yet-completed trading day.
        end = now.date() - timedelta(days=1)
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
                                # Blank means the latest completed US trading day.
                                "BYMD": "",
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
            await traffic_store.set_json(
                f"market:history:{instrument.id}", result[-80:], 3600
            )
            return [item.copy() for item in result[-80:]]
        except Exception as exc:
            logger.info("KIS history unavailable for %s: %s", instrument.id, exc)
            return []

    async def kospi_history(self) -> dict:
        now = datetime.now(UTC)
        if self._index_cache and (now - self._index_cache[0]).total_seconds() < 300:
            return self._index_cache[1]
        shared = await traffic_store.get_json("market:index:kospi")
        if shared:
            self._index_cache = (now, shared)
            return shared

        empty = parse_kospi_payload({}, now)
        if not self.configured:
            return empty

        start = now.date() - timedelta(days=60)
        try:
            async with self._rest_lock:
                await self._rate_limit_rest()
                token = await self._token()
                async with httpx.AsyncClient(timeout=15) as client:
                    response = await client.get(
                        (
                            f"{self.rest_base}/uapi/domestic-stock/v1/"
                            "quotations/inquire-daily-indexchartprice"
                        ),
                        headers=self._headers(token, "FHKUP03500100"),
                        params={
                            "FID_COND_MRKT_DIV_CODE": "U",
                            "FID_INPUT_ISCD": "0001",
                            "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
                            "FID_INPUT_DATE_2": now.strftime("%Y%m%d"),
                            "FID_PERIOD_DIV_CODE": "D",
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
            if payload.get("rt_cd") not in {None, "0"}:
                raise RuntimeError(payload.get("msg1") or "KIS index request failed")
            result = parse_kospi_payload(payload, now)
            if not result["points"]:
                raise RuntimeError("KIS returned no KOSPI history")
            self._index_cache = (now, result)
            await traffic_store.set_json("market:index:kospi", result, 300)
            return result
        except Exception as exc:
            logger.info("KIS KOSPI index unavailable: %s", exc)
            if self._index_cache:
                return {**self._index_cache[1], "stale": True}
            return empty

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
        response = await self._client().post(
            f"{self.rest_base}/oauth2/tokenP", json=payload
        )
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
        response = await self._client().post(
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
            client = self._client()
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
                (
                    item
                    for item in self._watched.values()
                    if item.market == "KR" and item.symbol == values[0]
                ),
                None,
            )
            if instrument:
                self._store(instrument, values[2], values[4], values[5], "WebSocket")
        elif tr_id == "HDFSCNT0" and len(values) >= len(OVERSEAS_COLUMNS):
            instrument = next(
                (
                    item
                    for item in self._watched.values()
                    if item.market == "US" and item.symbol == values[0]
                ),
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
