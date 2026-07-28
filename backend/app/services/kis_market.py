from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from datetime import UTC, datetime
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
                            "FID_COND_MRKT_DIV_CODE": "J",
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
        tr_id = "H0STCNT0" if instrument.market == "KR" else "HDFSCNT0"
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
        if tr_id == "H0STCNT0" and len(values) >= len(DOMESTIC_COLUMNS):
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
        self._quotes[instrument.id] = {
            **instrument.public(),
            "price": float(price),
            "change": float(_number(change_value)),
            "changePercent": float(_number(percent_value)),
            "marketState": "LIVE" if transport == "WebSocket" else "SNAPSHOT",
            "asOf": datetime.now(UTC).isoformat(),
            "source": f"KIS Open API · {transport}",
        }


kis_market = KISMarket()
