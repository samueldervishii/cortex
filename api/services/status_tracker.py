"""Status tracking: aggregate recorded probes into uptime summaries.

Probes are written by an external GitHub Actions workflow (see
`.github/workflows/status-probe.yml`), which runs on GitHub's
infrastructure so it can still record "down" samples when the Cortex
backend is asleep or dead. This module only reads from the collection.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

# Stable service identifiers. Order matters — this is the display order
# on the status page. The external prober must use these same ids when
# inserting documents.
SERVICES = [
    {"id": "api", "label": "API Server", "description": "Cortex backend"},
    {"id": "database", "label": "Database", "description": "MongoDB Atlas"},
]

STATUS_OPERATIONAL = "operational"
STATUS_DEGRADED = "degraded"
STATUS_DOWN = "down"
STATUS_UNKNOWN = "unknown"

# Priority for picking the "worst" status of a day: lower = worse.
_STATUS_RANK = {
    STATUS_DOWN: 0,
    STATUS_DEGRADED: 1,
    STATUS_UNKNOWN: 2,
    STATUS_OPERATIONAL: 3,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _worse_status(a: str, b: str) -> str:
    """Return the worse of two status values (lower rank wins)."""
    return a if _STATUS_RANK.get(a, 99) <= _STATUS_RANK.get(b, 99) else b


async def get_uptime_history(db: AsyncIOMotorDatabase) -> dict:
    """Aggregate recorded checks into a per-service uptime summary.

    For each service, returns:
      - current_status: the most recent status seen
      - last_checked: ISO timestamp of the most recent check
      - uptime_24h / uptime_7d: percent of probes that were operational
      - days: list of {date, status} for each of the last 7 days where we
        have data (worst status of the day wins)
      - sample_count_24h / sample_count_7d: how many probes we actually
        have in those windows, so the UI can show "insufficient data"
    """
    now = _utcnow()
    cutoff_7d = now - timedelta(days=7)
    cutoff_24h = now - timedelta(hours=24)

    services_out: list[dict] = []

    import asyncio

    for svc in SERVICES:
        svc_id = svc["id"]
        coll = db["service_checks"]

        # Run the three independent queries in parallel
        latest_doc, docs_24h, docs_7d = await asyncio.gather(
            coll.find_one(
                {"service": svc_id},
                sort=[("checked_at", -1)],
            ),
            coll.find(
                {"service": svc_id, "checked_at": {"$gte": cutoff_24h}},
                projection={"status": 1, "_id": 0},
            ).to_list(length=2000),
            coll.find(
                {"service": svc_id, "checked_at": {"$gte": cutoff_7d}},
                projection={
                    "status": 1,
                    "checked_at": 1,
                    "detail": 1,
                    "latency_ms": 1,
                    "_id": 0,
                },
            ).to_list(length=20000),
        )

        current_status = (latest_doc or {}).get("status", STATUS_UNKNOWN)
        latest_checked = (latest_doc or {}).get("checked_at")

        total_24h = len(docs_24h)
        ok_24h = sum(1 for d in docs_24h if d.get("status") == STATUS_OPERATIONAL)
        uptime_24h = (ok_24h / total_24h * 100.0) if total_24h else None
        total_7d = len(docs_7d)
        ok_7d = sum(1 for d in docs_7d if d.get("status") == STATUS_OPERATIONAL)
        uptime_7d = (ok_7d / total_7d * 100.0) if total_7d else None

        # Bucket checks by UTC date.  For each day we track total vs
        # operational probes and the worst individual probe (for tooltip
        # detail).  The bar *color* is driven by the daily uptime
        # percentage, NOT the single worst probe — otherwise one cold-start
        # timeout in an otherwise perfect day turns the whole bar red.
        day_map: dict[str, dict] = {}
        for d in docs_7d:
            dt = d.get("checked_at")
            if not isinstance(dt, datetime):
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            key = dt.date().isoformat()
            status = d.get("status", STATUS_UNKNOWN)
            bucket = day_map.get(key)
            if bucket is None:
                bucket = {
                    "total": 0,
                    "ok": 0,
                    "worst_detail": d.get("detail") or "",
                    "worst_latency_ms": d.get("latency_ms"),
                    "worst_rank": _STATUS_RANK.get(status, 99),
                }
                day_map[key] = bucket
            bucket["total"] += 1
            if status == STATUS_OPERATIONAL:
                bucket["ok"] += 1
            rank = _STATUS_RANK.get(status, 99)
            if rank < bucket["worst_rank"]:
                bucket["worst_rank"] = rank
                bucket["worst_detail"] = d.get("detail") or ""
                bucket["worst_latency_ms"] = d.get("latency_ms")

        days: list[dict[str, Any]] = []
        today = now.date()
        for offset in range(6, -1, -1):
            day = (today - timedelta(days=offset)).isoformat()
            bucket = day_map.get(day)
            if bucket is None:
                continue
            total = bucket["total"]
            uptime_pct = (bucket["ok"] / total * 100.0) if total else None

            # Derive bar status from the day's uptime percentage:
            #   ≥90% operational → green
            #   ≥50% operational → degraded (yellow)
            #   <50% operational → down (red)
            if uptime_pct is not None and uptime_pct >= 90:
                day_status = STATUS_OPERATIONAL
            elif uptime_pct is not None and uptime_pct >= 50:
                day_status = STATUS_DEGRADED
            elif uptime_pct is not None:
                day_status = STATUS_DOWN
            else:
                day_status = STATUS_UNKNOWN

            days.append(
                {
                    "date": day,
                    "status": day_status,
                    "uptime_pct": uptime_pct,
                    "sample_count": total,
                    "detail": bucket["worst_detail"],
                    "latency_ms": bucket["worst_latency_ms"],
                }
            )

        services_out.append(
            {
                "id": svc_id,
                "label": svc["label"],
                "description": svc["description"],
                "current_status": current_status,
                "last_checked": latest_checked.isoformat() + "Z"
                if isinstance(latest_checked, datetime)
                and latest_checked.tzinfo is None
                else (latest_checked.isoformat() if isinstance(latest_checked, datetime) else None),
                "uptime_24h": uptime_24h,
                "uptime_7d": uptime_7d,
                "sample_count_24h": total_24h,
                "sample_count_7d": total_7d,
                "days": days,
            }
        )

    # Compute overall: worst current status across services
    overall = STATUS_OPERATIONAL
    for svc in services_out:
        overall = _worse_status(overall, svc["current_status"])

    return {
        "overall_status": overall,
        "services": services_out,
        "generated_at": now.isoformat(),
    }
