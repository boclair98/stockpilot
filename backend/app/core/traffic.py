"""Shared traffic primitives with a safe single-process fallback.

Redis is deliberately treated as an accelerator, not a correctness
dependency. A temporary Redis outage must never stop trading or login.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from redis.asyncio import Redis

from app.core.config import settings

logger = logging.getLogger(__name__)
T = TypeVar("T")


class TrafficStore:
    def __init__(self) -> None:
        self._redis: Redis | None = None
        self._memory: dict[str, tuple[float, str]] = {}
        self._memory_counts: dict[str, tuple[float, int]] = {}
        self._lock = asyncio.Lock()
        self._single_flight: dict[str, asyncio.Lock] = {}
        self.available = False

    async def start(self) -> None:
        if not settings.redis_url:
            logger.info("REDIS_URL is unset; using process-local traffic store")
            return
        try:
            self._redis = Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=1.5,
                socket_timeout=1.5,
                health_check_interval=30,
            )
            await self._redis.ping()
            self.available = True
        except Exception:
            logger.exception("Redis unavailable; falling back to local memory")
            await self.close()

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()
        self._redis = None
        self.available = False

    async def get_json(self, key: str) -> Any | None:
        if self._redis:
            try:
                raw = await self._redis.get(key)
                return json.loads(raw) if raw else None
            except Exception:
                logger.warning("Redis GET failed", exc_info=True)
        async with self._lock:
            cached = self._memory.get(key)
            if not cached:
                return None
            expires_at, raw = cached
            if expires_at <= time.monotonic():
                self._memory.pop(key, None)
                return None
            return json.loads(raw)

    async def set_json(self, key: str, value: Any, ttl: int) -> None:
        raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if self._redis:
            try:
                await self._redis.set(key, raw, ex=max(1, ttl))
                return
            except Exception:
                logger.warning("Redis SET failed", exc_info=True)
        async with self._lock:
            self._memory[key] = (time.monotonic() + ttl, raw)
            if len(self._memory) > 512:
                now = time.monotonic()
                self._memory = {
                    item_key: item
                    for item_key, item in self._memory.items()
                    if item[0] > now
                }

    async def delete(self, *keys: str) -> None:
        if self._redis:
            try:
                await self._redis.delete(*keys)
            except Exception:
                logger.warning("Redis DELETE failed", exc_info=True)
        async with self._lock:
            for key in keys:
                self._memory.pop(key, None)

    async def get_or_set(
        self, key: str, ttl: int, factory: Callable[[], Awaitable[T]]
    ) -> T:
        cached = await self.get_json(key)
        if cached is not None:
            return cached
        if self._redis:
            lock_key = f"lock:{key}"
            token = secrets.token_hex(12)
            try:
                acquired = await self._redis.set(lock_key, token, nx=True, ex=30)
                if acquired:
                    try:
                        value = await factory()
                        await self.set_json(key, value, ttl)
                        return value
                    finally:
                        try:
                            await self._redis.eval(
                                "if redis.call('get', KEYS[1]) == ARGV[1] then "
                                "return redis.call('del', KEYS[1]) else return 0 end",
                                1,
                                lock_key,
                                token,
                            )
                        except Exception:
                            logger.warning(
                                "Redis single-flight release failed", exc_info=True
                            )
                for _ in range(40):
                    await asyncio.sleep(0.075)
                    cached = await self.get_json(key)
                    if cached is not None:
                        return cached
            except Exception:
                logger.warning("Redis single-flight failed", exc_info=True)
        async with self._lock:
            flight = self._single_flight.setdefault(key, asyncio.Lock())
        async with flight:
            cached = await self.get_json(key)
            if cached is not None:
                return cached
            value = await factory()
            await self.set_json(key, value, ttl)
            return value

    async def allow(self, key: str, limit: int, window_seconds: int = 60) -> bool:
        if self._redis:
            try:
                async with self._redis.pipeline(transaction=True) as pipe:
                    pipe.incr(key)
                    pipe.expire(key, window_seconds, nx=True)
                    current, _ = await pipe.execute()
                return int(current) <= limit
            except Exception:
                logger.warning("Redis rate limit failed", exc_info=True)
        now = time.monotonic()
        async with self._lock:
            expires_at, current = self._memory_counts.get(
                key, (now + window_seconds, 0)
            )
            if expires_at <= now:
                expires_at, current = now + window_seconds, 0
            current += 1
            self._memory_counts[key] = (expires_at, current)
            if len(self._memory_counts) > 4096:
                self._memory_counts = {
                    item_key: item
                    for item_key, item in self._memory_counts.items()
                    if item[0] > now
                }
            return current <= limit


class RequestMetrics:
    def __init__(self) -> None:
        self.started_at = time.time()
        self.in_flight = 0
        self.requests = 0
        self.errors = 0
        self.latency_ms = 0.0
        self.statuses: Counter[str] = Counter()
        self._lock = asyncio.Lock()

    async def begin(self) -> None:
        async with self._lock:
            self.in_flight += 1

    async def finish(self, status: int, latency_ms: float) -> None:
        async with self._lock:
            self.in_flight = max(0, self.in_flight - 1)
            self.requests += 1
            self.errors += int(status >= 500)
            self.latency_ms += latency_ms
            self.statuses[f"{status // 100}xx"] += 1

    async def snapshot(self) -> dict[str, Any]:
        async with self._lock:
            return {
                "uptimeSeconds": round(time.time() - self.started_at),
                "requests": self.requests,
                "inFlight": self.in_flight,
                "serverErrors": self.errors,
                "averageLatencyMs": round(
                    self.latency_ms / self.requests if self.requests else 0, 2
                ),
                "statuses": dict(self.statuses),
                "sharedCache": traffic_store.available,
            }


traffic_store = TrafficStore()
request_metrics = RequestMetrics()
