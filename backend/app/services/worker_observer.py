"""Bounded operational metadata only: never accounts, prices or exception text."""

from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TypeVar

from app.core.config import settings
from app.core.traffic import TrafficStore, traffic_store

T = TypeVar("T")
JOBS = {
    "alerts": "가격 알림 점검",
    "protections": "보호주문 점검",
    "personal": "정기매수·계좌 도구 점검",
}
JOB_TTL = 600
STALE_SECONDS = 150
JOB_TIMEOUT_SECONDS = 90
logger = logging.getLogger(__name__)


def age_seconds(value: object, now: datetime) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        at = datetime.fromisoformat(value)
        if at.tzinfo is None:
            return None
        seconds = (now - at).total_seconds()
        return max(0, seconds) if seconds >= -5 else None
    except (ValueError, TypeError):
        return None


class WorkerObserver:
    def __init__(self, store: TrafficStore | None = None):
        self.store = store if store is not None else traffic_store

    async def _get(self, key: str):
        try:
            return await self.store.get_json(key)
        except Exception:
            logger.warning("Worker observation read unavailable")
            return None

    async def _set(self, key: str, value: dict, ttl: int):
        try:
            await self.store.set_json(key, value, ttl)
        except Exception:
            # Observability cannot prevent a lease owner from doing its work.
            logger.warning("Worker observation write unavailable")

    async def run(self, name: str, action: Callable[[], Awaitable[T]]) -> T:
        """Called only inside the existing distributed job lease.

        Success means the bounded sweep returned, not that a trade filled or a
        notification arrived. Cancellation is never reported as successful.
        """
        if name not in JOBS:
            raise ValueError("Unknown worker job")
        key = f"worker:job:{name}"
        previous = await self._get(key)
        previous = previous if isinstance(previous, dict) else {}
        row = {
            "lastSuccessAt": previous.get("lastSuccessAt"),
            "startedAt": datetime.now(UTC).isoformat(),
            "state": "running",
            "durationMs": None,
            "errorType": None,
        }
        await self._set(key, row, JOB_TTL)
        start = time.monotonic()
        try:
            result = await asyncio.wait_for(action(), timeout=JOB_TIMEOUT_SECONDS)
        except asyncio.CancelledError:
            row.update(state="interrupted", errorType="CancelledError")
            raise
        except Exception as exc:
            row.update(state="failed", errorType=type(exc).__name__[:80])
            raise
        else:
            row.update(state="ok", lastSuccessAt=datetime.now(UTC).isoformat())
            return result
        finally:
            row["durationMs"] = round((time.monotonic() - start) * 1000, 2)
            row["finishedAt"] = datetime.now(UTC).isoformat()
            await self._set(key, row, JOB_TTL)

    async def beat(self, task_states: dict[str, bool]) -> None:
        await self._set(
            "worker:heartbeat",
            {
                "at": datetime.now(UTC).isoformat(),
                "scope": "latest-instance",
                "tasks": task_states,
            },
            ttl=45,
        )

    async def status(self) -> dict:
        now = datetime.now(UTC)
        values = await asyncio.gather(
            self._get("worker:heartbeat"),
            *(self._get(f"worker:job:{name}") for name in JOBS),
        )
        heartbeat = values[0] if isinstance(values[0], dict) else {}
        heartbeat_age = age_seconds(heartbeat.get("at"), now)
        live = heartbeat_age is not None and heartbeat_age <= 45
        rows = []
        for (name, label), value in zip(JOBS.items(), values[1:], strict=True):
            row = value if isinstance(value, dict) else {}
            state = row.get("state")
            started_age = age_seconds(row.get("startedAt"), now)
            success_age = age_seconds(row.get("lastSuccessAt"), now)
            if not live or started_age is None:
                state = "unknown"
            elif state == "running" and started_age > 120:
                state = "stale"
            elif state != "running" and (started_age > STALE_SECONDS):
                state = "stale"
            elif state not in {"ok", "running", "failed", "interrupted"}:
                state = "unknown"
            elif state == "ok" and (success_age is None or success_age > STALE_SECONDS):
                state = "stale"
            duration = row.get("durationMs")
            rows.append(
                {
                    "id": name,
                    "label": label,
                    "state": state,
                    "startedAt": row.get("startedAt")
                    if started_age is not None
                    else None,
                    "lastSuccessAt": row.get("lastSuccessAt")
                    if success_age is not None
                    else None,
                    "durationMs": duration
                    if isinstance(duration, (int, float))
                    and not isinstance(duration, bool)
                    and math.isfinite(duration)
                    and duration >= 0
                    else None,
                    "errorType": row.get("errorType")[:80]
                    if state in {"failed", "interrupted"}
                    and isinstance(row.get("errorType"), str)
                    else None,
                }
            )
        shared = self.store.available if settings.redis_url else None
        overall = (
            "unknown"
            if not live
            else "healthy"
            if all(row["state"] in {"ok", "running"} for row in rows)
            else "degraded"
        )
        if settings.redis_url and not shared:
            overall = "unknown"
        tasks = heartbeat.get("tasks")
        if (
            live
            and isinstance(tasks, dict)
            and any(tasks.get(name) is not True for name in JOBS)
        ):
            overall = "degraded" if overall != "unknown" else overall
        return {
            "status": overall,
            "checkedAt": now.isoformat(),
            "heartbeatAt": heartbeat.get("at") if heartbeat_age is not None else None,
            "heartbeatAgeSeconds": round(heartbeat_age, 1)
            if heartbeat_age is not None
            else None,
            "sharedCache": shared,
            "scope": "latest-instance-and-leased-jobs",
            "jobs": rows,
            "note": "최근 응답한 워커와 점검 기록입니다. 점검 성공은 주문 체결·푸시 수신을 보장하지 않습니다. 전체 인스턴스 수는 집계하지 않습니다.",
        }


worker_observer = WorkerObserver()
