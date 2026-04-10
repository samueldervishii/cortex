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

    for svc in SERVICES:
        svc_id = svc["id"]
        coll = db["service_checks"]

        # Most recent check
        latest_doc = await coll.find_one(
            {"service": svc_id},
            sort=[("checked_at", -1)],
        )
        current_status = (latest_doc or {}).get("status", STATUS_UNKNOWN)
        latest_checked = (latest_doc or {}).get("checked_at")

        # 24h samples
        docs_24h = await coll.find(
            {"service": svc_id, "checked_at": {"$gte": cutoff_24h}},
            projection={"status": 1, "_id": 0},
        ).to_list(length=2000)
        total_24h = len(docs_24h)
        ok_24h = sum(1 for d in docs_24h if d.get("status") == STATUS_OPERATIONAL)
        uptime_24h = (ok_24h / total_24h * 100.0) if total_24h else None

        # 7d samples (used for the daily roll-up and the 7d uptime %)
        docs_7d = await coll.find(
            {"service": svc_id, "checked_at": {"$gte": cutoff_7d}},
            projection={"status": 1, "checked_at": 1, "_id": 0},
        ).to_list(length=20000)
        total_7d = len(docs_7d)
        ok_7d = sum(1 for d in docs_7d if d.get("status") == STATUS_OPERATIONAL)
        uptime_7d = (ok_7d / total_7d * 100.0) if total_7d else None

        # Bucket checks by UTC date, taking the worst status per day.
        day_map: dict[str, str] = {}
        for d in docs_7d:
            dt = d.get("checked_at")
            if not isinstance(dt, datetime):
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            key = dt.date().isoformat()
            prev = day_map.get(key)
            status = d.get("status", STATUS_UNKNOWN)
            day_map[key] = _worse_status(prev, status) if prev else status

        # Produce an ordered list for the last 7 days (oldest → newest).
        # Only include days we actually have data for.
        days: list[dict[str, Any]] = []
        today = now.date()
        for offset in range(6, -1, -1):
            day = (today - timedelta(days=offset)).isoformat()
            if day in day_map:
                days.append({"date": day, "status": day_map[day]})

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
