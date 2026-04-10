"""External status prober run from GitHub Actions.

This script is the "observer" in the status tracking system. It runs on
GitHub's infrastructure (not on Render), so it can still record a "down"
sample when the Cortex backend is asleep or dead.

Flow:
    1. HTTP GET against /health on the Cortex backend.
    2. Categorize the outcome into operational / degraded / down based on
       HTTP status code and whether we got a response at all.
    3. Connect directly to MongoDB Atlas (not through the backend) and
       insert a single document into `service_checks`.

Why not talk to the backend's /status/probe endpoint?
    Because when the backend is down, that POST would also fail and we
    would lose the "down" sample — which is the entire point of having an
    external observer. Direct DB writes are the only way to guarantee the
    sample is recorded.

Environment variables (set as GitHub Actions secrets):
    CORTEX_HEALTH_URL   Full URL to the /health endpoint on Cortex API
    MONGODB_URL         mongodb+srv://... connection string for Atlas
    MONGODB_DATABASE    Database name (usually `thesis_db`)
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone

import httpx
from pymongo import MongoClient
from pymongo.errors import PyMongoError

# Probe targets a single service for now. If you add more external
# dependencies later (e.g. a storage bucket), they go here.
SERVICE_ID = "api"

# Long enough to survive a Render free-tier cold start (typically
# 30–60s). Without this, the first probe after an idle period would get
# logged as "down" even though the service is actually fine.
HTTP_TIMEOUT_SECONDS = 45.0

# Latency above this threshold is still "operational" but worth noting —
# it usually means Render just spun the instance back up.
SLOW_THRESHOLD_MS = 3000


def classify_response(status_code: int | None, latency_ms: int | None) -> tuple[str, str]:
    """Map raw probe outcome to (status, human-readable detail)."""
    if status_code is None:
        return "down", "Unreachable (timeout or connection error)"
    if 200 <= status_code < 300:
        if latency_ms is not None and latency_ms > SLOW_THRESHOLD_MS:
            return "operational", f"Slow response ({latency_ms}ms — likely cold start)"
        return "operational", "Responding to requests"
    if 500 <= status_code < 600:
        return "degraded", f"Server error {status_code}"
    return "degraded", f"Unexpected status {status_code}"


def probe(url: str) -> dict:
    """Hit the health endpoint and return a probe result dict."""
    started = time.perf_counter()
    status_code: int | None = None
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = client.get(url)
            status_code = response.status_code
    except httpx.TimeoutException:
        # Timed out even after the generous window — treat as down.
        pass
    except httpx.HTTPError as exc:
        # Network error, DNS failure, TLS failure, etc.
        print(f"probe: http error: {type(exc).__name__}: {exc}", file=sys.stderr)

    latency_ms: int | None = (
        int((time.perf_counter() - started) * 1000) if status_code is not None else None
    )
    status, detail = classify_response(status_code, latency_ms)

    return {
        "service": SERVICE_ID,
        "status": status,
        "checked_at": datetime.now(timezone.utc),
        "latency_ms": latency_ms,
        "detail": detail,
        # Stamp every sample with who wrote it so we can tell external
        # probes apart from any in-process ones still lurking in the data.
        "source": "github-actions",
    }


def record(mongo_url: str, db_name: str, doc: dict) -> None:
    """Write a single probe document into `service_checks`."""
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=10_000)
    try:
        db = client[db_name]
        db["service_checks"].insert_one(doc)
    finally:
        client.close()


def main() -> int:
    health_url = os.environ.get("CORTEX_HEALTH_URL", "").strip()
    mongo_url = os.environ.get("MONGODB_URL", "").strip()
    db_name = os.environ.get("MONGODB_DATABASE", "").strip()

    missing = [
        name
        for name, value in (
            ("CORTEX_HEALTH_URL", health_url),
            ("MONGODB_URL", mongo_url),
            ("MONGODB_DATABASE", db_name),
        )
        if not value
    ]
    if missing:
        print(f"probe: missing required secrets: {', '.join(missing)}", file=sys.stderr)
        return 2

    result = probe(health_url)
    print(
        f"probe: service={result['service']} status={result['status']} "
        f"latency_ms={result['latency_ms']} detail={result['detail']!r}"
    )

    try:
        record(mongo_url, db_name, result)
    except PyMongoError as exc:
        print(f"probe: failed to write to MongoDB: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
