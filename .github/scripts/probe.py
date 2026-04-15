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

# Long enough to survive a Render free-tier cold start (typically
# 30–60s, occasionally longer).  Previous value of 45s was marginal;
# bumped to 90s so even a sluggish wake-up isn't misclassified as down.
HTTP_TIMEOUT_SECONDS = 90.0

# If the first attempt times out (likely a cold start that's still
# booting), wait this many seconds and try once more.  The instance
# should be warm by then.
RETRY_DELAY_SECONDS = 10.0

# Latency above this threshold is still "operational" but worth noting —
# it usually means Render just spun the instance back up.
SLOW_THRESHOLD_MS = 5000

# Atlas ping threshold. Anything over this is still "operational" but
# tagged as slow — Atlas free tier occasionally has high-latency bursts
# when the shared cluster is under load.
DB_SLOW_THRESHOLD_MS = 2000

# Fail the Atlas connection attempt quickly if we can't even reach the
# cluster — we'd rather log "down" than block the whole workflow run.
DB_CONNECT_TIMEOUT_MS = 10_000


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


def _single_probe(url: str) -> tuple[int | None, int | None]:
    """Make one HTTP GET and return (status_code, latency_ms)."""
    started = time.perf_counter()
    status_code: int | None = None
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = client.get(url)
            status_code = response.status_code
    except httpx.TimeoutException:
        pass
    except httpx.HTTPError as exc:
        print(f"probe: http error: {type(exc).__name__}: {exc}", file=sys.stderr)

    latency_ms: int | None = (
        int((time.perf_counter() - started) * 1000) if status_code is not None else None
    )
    return status_code, latency_ms


def probe_api(url: str) -> dict:
    """Hit the Cortex /health endpoint and return a probe result dict.

    If the first attempt times out (common with Render cold starts),
    waits briefly and retries once — the instance should be warm by then.
    """
    status_code, latency_ms = _single_probe(url)

    if status_code is None:
        print(f"probe: first attempt failed, retrying in {RETRY_DELAY_SECONDS}s…", file=sys.stderr)
        time.sleep(RETRY_DELAY_SECONDS)
        status_code, latency_ms = _single_probe(url)

    status, detail = classify_response(status_code, latency_ms)

    return {
        "service": "api",
        "status": status,
        "checked_at": datetime.now(timezone.utc),
        "latency_ms": latency_ms,
        "detail": detail,
        "source": "github-actions",
    }


def probe_database(mongo_url: str) -> tuple[dict, MongoClient | None]:
    """Ping Atlas directly and return a probe result + the open client.

    Returning the client lets the caller reuse the same connection for
    the subsequent write, avoiding a second TLS handshake.
    """
    started = time.perf_counter()
    status = "down"
    detail = "Unreachable"
    latency_ms: int | None = None
    client: MongoClient | None = None

    try:
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=DB_CONNECT_TIMEOUT_MS)
        # Force a real round trip — MongoClient() alone is lazy.
        client.admin.command("ping")
        latency_ms = int((time.perf_counter() - started) * 1000)
        if latency_ms > DB_SLOW_THRESHOLD_MS:
            status = "operational"
            detail = f"Slow response ({latency_ms}ms)"
        else:
            status = "operational"
            detail = "Responding to queries"
    except PyMongoError as exc:
        status = "down"
        detail = f"Unreachable: {type(exc).__name__}"
        print(f"probe: db error: {type(exc).__name__}: {exc}", file=sys.stderr)
        if client is not None:
            client.close()
            client = None
    except Exception as exc:
        # Catch anything weird (DNS resolution, TLS, etc.) so one bad
        # probe can't crash the whole run.
        status = "down"
        detail = f"Unexpected error: {type(exc).__name__}"
        print(f"probe: db error: {type(exc).__name__}: {exc}", file=sys.stderr)
        if client is not None:
            client.close()
            client = None

    doc = {
        "service": "database",
        "status": status,
        "checked_at": datetime.now(timezone.utc),
        "latency_ms": latency_ms,
        "detail": detail,
        "source": "github-actions",
    }
    return doc, client


def record_many(mongo_url: str, db_name: str, docs: list[dict], client: MongoClient | None) -> None:
    """Write multiple probe documents into `service_checks`.

    If the caller already opened a MongoClient (from probe_database), we
    reuse it. Otherwise we open a fresh one just for the write. If both
    probes failed in a way that left us without a working client, we
    still try to record them — the API probe might have succeeded even
    when the DB ping failed for transient reasons.
    """
    if not docs:
        return

    owned = False
    if client is None:
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=DB_CONNECT_TIMEOUT_MS)
        owned = True

    try:
        db = client[db_name]
        db["service_checks"].insert_many(docs, ordered=False)
    finally:
        if owned:
            client.close()


def _log(result: dict) -> None:
    print(
        f"probe: service={result['service']} status={result['status']} "
        f"latency_ms={result['latency_ms']} detail={result['detail']!r}"
    )


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

    # Run both probes before writing so one slow probe doesn't delay the
    # other's timestamp in the DB.
    api_result = probe_api(health_url)
    _log(api_result)

    db_result, db_client = probe_database(mongo_url)
    _log(db_result)

    try:
        record_many(mongo_url, db_name, [api_result, db_result], db_client)
    except PyMongoError as exc:
        print(f"probe: failed to write to MongoDB: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        if db_client is not None:
            db_client.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
