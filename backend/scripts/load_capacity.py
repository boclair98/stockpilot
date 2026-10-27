"""Bounded open-loop READ load test. Requires an isolated fixture handshake.

Never retries requests, sends credentials, follows redirects, or targets the
production StockPilot host. See docs/sec-load-verification-20261027.md.
"""

from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import math
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx

CONTRACT = "stockpilot-isolated-load-v1"
PRODUCTION_HOSTS = {"stockpilot.coders.kr", "stockpilot.kr", "www.stockpilot.kr"}
SCENARIOS = (
    ("/api/company/us/AAPL", "AAPL"),
    ("/api/company/us/MSFT", "MSFT"),
    ("/api/company/us-lookup?symbol=BRK%2FB", "BRK/B"),
)


def validate_target(url: str, allow_host: str | None = None) -> str:
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
        or parsed.hostname in PRODUCTION_HOSTS
    ):
        raise ValueError(
            "Use an isolated base origin, never production or credentials."
        )
    try:
        local = ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        local = parsed.hostname == "localhost"
    if not local and (parsed.scheme != "https" or allow_host != parsed.hostname):
        raise ValueError("External staging needs HTTPS and an exact --allow-host.")
    # Accessing port validates malformed/out-of-range values too.
    _ = parsed.port
    return url.rstrip("/")


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    return round(ordered[max(0, math.ceil(len(ordered) * quantile) - 1)], 2)


async def run_stage(client, rate, duration, concurrency, max_p95_ms):
    """No unbounded queue: late launches and full slots are counted as drops."""
    pending: set[asyncio.Task] = set()
    latency: list[float] = []
    statuses: Counter[str] = Counter()
    errors: Counter[str] = Counter()
    completed = 0
    launched = 0
    dropped = 0
    peak = 0
    stopped = asyncio.Event()
    started = time.perf_counter()

    async def send(sequence):
        nonlocal completed
        path, symbol = SCENARIOS[sequence % len(SCENARIOS)]
        at = time.perf_counter()
        try:
            response = await client.get(path)
            statuses[str(response.status_code)] += 1
            if response.status_code != 200:
                errors["http"] += 1
            else:
                body = response.json()
                if not (
                    isinstance(body, dict)
                    and body.get("available") is True
                    and body.get("symbol") == symbol
                    and isinstance(body.get("disclosures"), list)
                ):
                    errors["invalid_payload"] += 1
        except httpx.HTTPError:
            statuses["network_error"] += 1
            errors["network"] += 1
        except (ValueError, TypeError):
            errors["invalid_json"] += 1
        finally:
            latency.append((time.perf_counter() - at) * 1000)
            completed += 1
            # Early stop prevents amplifying a server already failing under load.
            if completed >= 50 and sum(errors.values()) / completed > 0.05:
                stopped.set()

    planned = int(rate * duration)
    for sequence in range(planned):
        if stopped.is_set():
            break
        due = started + sequence / rate
        await asyncio.sleep(max(0, due - time.perf_counter()))
        # Do not burst to catch up if the generator itself was CPU saturated.
        if (
            time.perf_counter() - due > max(0.02, 2 / rate)
            or len(pending) >= concurrency
        ):
            dropped += 1
            continue
        task = asyncio.create_task(send(sequence))
        pending.add(task)
        task.add_done_callback(pending.discard)
        launched += 1
        peak = max(peak, len(pending))
    # Include the final scheduled interval in achieved-rate accounting.
    if not stopped.is_set():
        await asyncio.sleep(max(0, started + duration - time.perf_counter()))
    offered_seconds = time.perf_counter() - started
    if pending:
        await asyncio.gather(*tuple(pending))
    elapsed = time.perf_counter() - started
    error_rate = sum(errors.values()) / completed if completed else 1
    p95 = percentile(latency, 0.95)
    passed = (
        not stopped.is_set()
        and error_rate <= 0.01
        and dropped == 0
        and completed == planned
        and p95 <= max_p95_ms
    )
    return {
        "requestedRps": rate,
        "durationSeconds": duration,
        "planned": planned,
        "launched": launched,
        "completed": completed,
        "droppedByGenerator": dropped,
        "notLaunchedAfterStop": planned - launched - dropped,
        "peakInFlight": peak,
        "elapsedSeconds": round(elapsed, 3),
        "achievedLaunchRps": round(launched / offered_seconds, 2),
        "completedRps": round(completed / elapsed, 2),
        "p50Ms": percentile(latency, 0.5),
        "p95Ms": p95,
        "p99Ms": percentile(latency, 0.99),
        "statuses": dict(statuses),
        "errors": dict(errors),
        "errorRate": round(error_rate, 6),
        "passed": passed,
        "stoppedEarly": stopped.is_set(),
    }


async def measure(args):
    target = validate_target(args.base_url, args.allow_host)
    async with httpx.AsyncClient(
        base_url=target,
        timeout=httpx.Timeout(5, connect=2),
        follow_redirects=False,
        trust_env=False,
        limits=httpx.Limits(
            max_connections=args.concurrency, max_keepalive_connections=args.concurrency
        ),
        headers={"User-Agent": "StockPilot-Isolated-Load/1.0"},
    ) as client:
        response = await client.get("/__loadtest__/manifest")
        response.raise_for_status()
        manifest = response.json()
        if not (
            isinstance(manifest, dict)
            and manifest.get("contract") == CONTRACT
            and manifest.get("isolated") is True
            and manifest.get("upstream") == "mock"
        ):
            raise ValueError("Isolated target handshake failed; no load was sent.")
        before = (await client.get("/__loadtest__/stats")).json()
        stages = []
        for rate in args.rates:
            stage = await run_stage(
                client, rate, args.seconds, args.concurrency, args.max_p95_ms
            )
            stages.append(stage)
            print(json.dumps(stage, ensure_ascii=False), flush=True)
            if not stage["passed"]:
                break
        after = (await client.get("/__loadtest__/stats")).json()
    return {
        "at": datetime.now(UTC).isoformat(),
        "target": target,
        "scope": manifest,
        "statsBefore": before,
        "statsAfter": after,
        "criteria": {
            "maxP95Ms": args.max_p95_ms,
            "maxErrorRate": 0.01,
            "allowedGeneratorDrops": 0,
        },
        "stages": stages,
        "passedRequestedStages": len(stages) == len(args.rates)
        and all(s["passed"] for s in stages),
        "limitations": [
            "Synthetic SEC read route + local cache only; no real SEC/KIS traffic.",
            "No PostgreSQL/Redis, authenticated orders, websocket, frontend or CDN capacity claim.",
            "Same-host generator and server; lab result is not production/user concurrency capacity.",
        ],
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8276")
    parser.add_argument("--allow-host")
    parser.add_argument("--rates", default="25,50,100,200,400")
    parser.add_argument("--seconds", type=int, default=15)
    parser.add_argument("--concurrency", type=int, default=100)
    parser.add_argument("--max-p95-ms", type=float, default=500)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        args.rates = [int(rate) for rate in args.rates.split(",")]
        validate_target(args.base_url, args.allow_host)
        if not (
            1 <= len(args.rates) <= 10
            and all(1 <= r <= 1000 for r in args.rates)
            and 1 <= args.seconds <= 120
            and 1 <= args.concurrency <= 500
            and math.isfinite(args.max_p95_ms)
            and 1 <= args.max_p95_ms <= 10000
        ):
            raise ValueError("Bounded limits: 1..1000 RPS, 1..120s, 1..500 in-flight.")
    except ValueError as exc:
        parser.error(str(exc))
    return args


def cli():
    args = parse_args()
    report = asyncio.run(measure(args))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    raise SystemExit(0 if report["passedRequestedStages"] else 1)


if __name__ == "__main__":
    cli()
