"""Usage tracking: 5-hour rolling buckets per user.

Each bucket is a document in the `usage_buckets` collection. A new bucket is
created lazily the first time a user records activity after their previous
bucket expired, so the "resets in X" timer is personal to each user rather
than a wall-clock rollover.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

BUCKET_DURATION = timedelta(hours=5)
HISTORY_DEFAULT_DAYS = 30

# Hard cap on tokens per 5-hour bucket. Enforced in the stream endpoint.
# When plans land, this becomes a per-plan lookup rather than a constant.
LIMIT_TOKENS = 200_000

# Claude Sonnet 4.6 output ceiling. Any dynamic max_tokens we compute is
# clamped to this value.
MODEL_MAX_TOKENS = 64000

# Explicit budget for the "thinking" phase of a response. Prevents adaptive
# thinking from eating the whole output budget. 12k is comfortable for deep
# reasoning without starving the visible output.
THINKING_BUDGET = 12000

# Upper bound for the visible output portion of a single response.
# (MODEL_MAX_TOKENS - THINKING_BUDGET)
MAX_OUTPUT_TOKENS = MODEL_MAX_TOKENS - THINKING_BUDGET  # 52000

# Headroom reserved for the next assistant response when checking the quota.
# = THINKING_BUDGET (12k) + a 4k minimum output floor. If the bucket has
# fewer tokens left than this, the stream endpoint returns 429.
RESPONSE_TOKEN_RESERVE = THINKING_BUDGET + 4000  # 16000


def format_reset_time(seconds: int) -> str:
    """Format a reset countdown for human error messages (e.g. '3h 14m')."""
    seconds = max(0, int(seconds))
    if seconds <= 0:
        return "now"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    if hours > 0:
        return f"{hours}h {minutes}m"
    if minutes > 0:
        return f"{minutes}m"
    return f"{seconds}s"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _empty_bucket_payload(user_id: str, now: datetime) -> dict:
    return {
        "user_id": user_id,
        "bucket_start": now,
        "bucket_end": now + BUCKET_DURATION,
        "input_tokens": 0,
        "output_tokens": 0,
        "message_count": 0,
        "artifact_count": 0,
        "file_upload_count": 0,
    }


async def _get_or_create_current_bucket(
    db: AsyncIOMotorDatabase, user_id: str
) -> dict:
    """Return the active bucket for a user, creating one if none exists."""
    now = _utcnow()
    coll = db["usage_buckets"]

    bucket = await coll.find_one(
        {"user_id": user_id, "bucket_end": {"$gt": now}},
        sort=[("bucket_end", -1)],
    )
    if bucket is not None:
        return bucket

    payload = _empty_bucket_payload(user_id, now)
    result = await coll.insert_one(payload)
    payload["_id"] = result.inserted_id
    return payload


async def record_usage(
    db: AsyncIOMotorDatabase,
    user_id: str,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    is_artifact: bool = False,
    has_file: bool = False,
) -> dict:
    """Increment counters on the user's current bucket and return it."""
    bucket = await _get_or_create_current_bucket(db, user_id)

    inc: dict = {
        "input_tokens": max(0, int(input_tokens)),
        "output_tokens": max(0, int(output_tokens)),
        "message_count": 1,
    }
    if is_artifact:
        inc["artifact_count"] = 1
    if has_file:
        inc["file_upload_count"] = 1

    from pymongo import ReturnDocument

    updated = await db["usage_buckets"].find_one_and_update(
        {"_id": bucket["_id"]},
        {"$inc": inc},
        return_document=ReturnDocument.AFTER,
    )
    return _serialize_bucket(updated or bucket)


def _serialize_bucket(bucket: Optional[dict]) -> Optional[dict]:
    if not bucket:
        return None
    now = _utcnow()
    end = bucket.get("bucket_end")
    start = bucket.get("bucket_start")
    if isinstance(end, datetime) and end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if isinstance(start, datetime) and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)

    resets_in_seconds = 0
    if isinstance(end, datetime):
        resets_in_seconds = max(0, int((end - now).total_seconds()))

    return {
        "bucket_start": start.isoformat() if isinstance(start, datetime) else None,
        "bucket_end": end.isoformat() if isinstance(end, datetime) else None,
        "resets_in_seconds": resets_in_seconds,
        "input_tokens": int(bucket.get("input_tokens", 0)),
        "output_tokens": int(bucket.get("output_tokens", 0)),
        "total_tokens": int(bucket.get("input_tokens", 0)) + int(bucket.get("output_tokens", 0)),
        "message_count": int(bucket.get("message_count", 0)),
        "artifact_count": int(bucket.get("artifact_count", 0)),
        "file_upload_count": int(bucket.get("file_upload_count", 0)),
    }


def _empty_current_payload() -> dict:
    return {
        "bucket_start": None,
        "bucket_end": None,
        "resets_in_seconds": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "message_count": 0,
        "artifact_count": 0,
        "file_upload_count": 0,
    }


async def get_current_usage(db: AsyncIOMotorDatabase, user_id: str) -> dict:
    """Return the user's active bucket without creating one if none exists.

    If the user has no active bucket, returns a zeroed payload with no timer
    — the bucket will be created on first actual activity.
    """
    now = _utcnow()
    bucket = await db["usage_buckets"].find_one(
        {"user_id": user_id, "bucket_end": {"$gt": now}},
        sort=[("bucket_end", -1)],
    )
    if bucket is None:
        return _empty_current_payload()
    return _serialize_bucket(bucket)


async def get_usage_history(
    db: AsyncIOMotorDatabase, user_id: str, days: int = HISTORY_DEFAULT_DAYS
) -> dict:
    """Aggregate a user's activity over the last N days."""
    days = max(1, min(days, 90))
    cutoff = _utcnow() - timedelta(days=days)

    pipeline = [
        {"$match": {"user_id": user_id, "bucket_start": {"$gte": cutoff}}},
        {
            "$group": {
                "_id": None,
                "input_tokens": {"$sum": "$input_tokens"},
                "output_tokens": {"$sum": "$output_tokens"},
                "message_count": {"$sum": "$message_count"},
                "artifact_count": {"$sum": "$artifact_count"},
                "file_upload_count": {"$sum": "$file_upload_count"},
            }
        },
    ]

    cursor = db["usage_buckets"].aggregate(pipeline)
    docs = await cursor.to_list(length=1)

    if not docs:
        return {
            "days": days,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "message_count": 0,
            "artifact_count": 0,
            "file_upload_count": 0,
        }

    row = docs[0]
    input_t = int(row.get("input_tokens", 0))
    output_t = int(row.get("output_tokens", 0))
    return {
        "days": days,
        "input_tokens": input_t,
        "output_tokens": output_t,
        "total_tokens": input_t + output_t,
        "message_count": int(row.get("message_count", 0)),
        "artifact_count": int(row.get("artifact_count", 0)),
        "file_upload_count": int(row.get("file_upload_count", 0)),
    }
