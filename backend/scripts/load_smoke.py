"""Small read-only concurrency smoke test for a deployed StockPilot API.

Usage:
    python scripts/load_smoke.py https://stockpilot.coders.kr 300 30
"""

from __future__ import annotations

import asyncio
import statistics
import sys
import time

import httpx


async def main(base_url: str, requests: int, concurrency: int) -> int:
    semaphore = asyncio.Semaphore(concurrency)
    latencies: list[float] = []
    statuses: dict[int, int] = {}

    async with httpx.AsyncClient(
        base_url=base_url.rstrip("/"), timeout=20, http2=True
    ) as client:

        async def send() -> None:
            async with semaphore:
                started = time.perf_counter()
                try:
                    response = await client.get("/api/league/rankings")
                    statuses[response.status_code] = statuses.get(response.status_code, 0) + 1
                except httpx.HTTPError:
                    statuses[0] = statuses.get(0, 0) + 1
                finally:
                    latencies.append((time.perf_counter() - started) * 1000)

        wall_started = time.perf_counter()
        await asyncio.gather(*(send() for _ in range(requests)))
        elapsed = time.perf_counter() - wall_started

    ordered = sorted(latencies)
    p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
    print(f"requests={requests} concurrency={concurrency}")
    print(f"throughput={requests / elapsed:.1f} req/s")
    print(f"latency_mean={statistics.fmean(latencies):.1f}ms p95={p95:.1f}ms")
    print(f"statuses={statuses}")
    return 0 if statuses.get(200) == requests else 1


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    total = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    parallel = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    raise SystemExit(asyncio.run(main(target, total, parallel)))
