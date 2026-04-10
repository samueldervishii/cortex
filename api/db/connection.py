import asyncio
import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from config import settings

logger = logging.getLogger("cortex.db")

_client: AsyncIOMotorClient | None = None
_database: AsyncIOMotorDatabase | None = None
_indexes_created: bool = False
_db_lock = asyncio.Lock()


async def get_database() -> AsyncIOMotorDatabase:
    """Get the MongoDB database instance."""
    global _client, _database

    if _database is None:
        async with _db_lock:
            if _database is None:
                # Pool settings tuned for moderate load (~10-20 concurrent users).
                # maxPoolSize=20 handles concurrent API calls with retries.
                # minPoolSize=5 keeps connections warm to avoid cold-start latency.
                _client = AsyncIOMotorClient(
                    settings.mongodb_url,
                    maxPoolSize=20,
                    minPoolSize=5,
                    maxIdleTimeMS=30000,     # Close idle connections after 30s
                    connectTimeoutMS=10000,   # 10s to establish connection
                    serverSelectionTimeoutMS=10000,
                    retryWrites=True,
                    retryReads=True,
                )
                _database = _client[settings.mongodb_database]

    return _database


async def _create_index(collection, keys, *, critical: bool = False, **kwargs) -> bool:
    """Create a single index, logging failures individually.

    Args:
        critical: If True, the index enforces a security/integrity invariant.
                  Failure is logged at ERROR and counted so startup can abort.
    """
    name = kwargs.get("name", str(keys))
    try:
        await collection.create_index(keys, **kwargs)
        return True
    except Exception as e:
        if critical:
            logger.error(f"CRITICAL index failed ({name}): {e}")
        else:
            logger.warning(f"Index creation skipped ({name}): {e}")
        return False


async def ensure_indexes(database: AsyncIOMotorDatabase) -> None:
    """Create indexes for optimal query performance.

    Each index is created independently so one failure does not block
    the rest.  Indexes marked critical=True enforce security or data-
    integrity invariants; if any of them fail the function raises so
    the caller can decide whether to abort startup.
    """
    global _indexes_created

    if _indexes_created:
        return

    critical_failures = 0

    sessions = database["sessions"]
    users = database["users"]
    settings_col = database["user_settings"]
    artifacts = database["artifacts"]
    sources = database["sources"]
    file_storage = database["file_storage"]
    refresh_tokens = database["refresh_tokens"]
    usage_buckets = database["usage_buckets"]
    service_checks = database["service_checks"]

    # ── Sessions ──
    await _create_index(sessions, [("id", ASCENDING)], unique=True, name="idx_session_id")

    try:
        await sessions.drop_index("idx_share_token")
    except Exception:
        pass
    await _create_index(
        sessions, [("share_token", ASCENDING)],
        unique=True,
        partialFilterExpression={"share_token": {"$type": "string"}},
        name="idx_share_token",
    )

    await _create_index(
        sessions, [("is_deleted", ASCENDING), ("created_at", DESCENDING)],
        name="idx_list_sessions",
    )
    await _create_index(
        sessions, [("is_pinned", ASCENDING), ("pinned_at", DESCENDING)],
        sparse=True, name="idx_pinned_sessions",
    )
    await _create_index(
        sessions, [("user_id", ASCENDING), ("is_deleted", ASCENDING), ("created_at", DESCENDING)],
        name="idx_user_sessions",
    )

    # ── User settings ──
    await _create_index(settings_col, [("user_id", ASCENDING)], unique=True, name="idx_user_id")

    # ── Users ──
    await _create_index(users, [("id", ASCENDING)], unique=True, name="idx_user_id_pk")
    await _create_index(users, [("email", ASCENDING)], unique=True, name="idx_user_email")
    await _create_index(
        users, [("username", ASCENDING)],
        unique=True,
        partialFilterExpression={"username": {"$type": "string", "$gt": ""}},
        name="idx_user_username",
    )

    # ── Artifacts ──
    await _create_index(
        artifacts, [("session_id", ASCENDING), ("created_at", ASCENDING)],
        name="idx_artifact_session",
    )

    # ── Sources ──
    await _create_index(
        sources, [("session_id", ASCENDING), ("created_at", ASCENDING)],
        name="idx_source_session",
    )
    await _create_index(sources, [("id", ASCENDING)], unique=True, name="idx_source_id")

    # CRITICAL: dedup indexes enforce data-integrity for concurrent source registration
    if not await _create_index(
        sources,
        [("session_id", ASCENDING), ("kind", ASCENDING), ("normalized_url", ASCENDING)],
        unique=True,
        partialFilterExpression={"kind": "url", "normalized_url": {"$type": "string"}},
        name="idx_source_url_dedup",
        critical=True,
    ):
        critical_failures += 1
    if not await _create_index(
        sources,
        [("session_id", ASCENDING), ("kind", ASCENDING), ("filename", ASCENDING)],
        unique=True,
        partialFilterExpression={"kind": "file", "filename": {"$type": "string"}},
        name="idx_source_file_dedup",
        critical=True,
    ):
        critical_failures += 1

    # ── File storage ──
    await _create_index(file_storage, [("id", ASCENDING)], unique=True, name="idx_file_storage_id")
    await _create_index(file_storage, [("session_id", ASCENDING)], name="idx_file_storage_session")

    # CRITICAL: refresh token family uniqueness enforces rotation security
    if not await _create_index(
        refresh_tokens, [("family_id", ASCENDING)],
        unique=True, name="idx_rt_family", critical=True,
    ):
        critical_failures += 1
    await _create_index(refresh_tokens, [("user_id", ASCENDING)], name="idx_rt_user")
    await _create_index(
        refresh_tokens, [("created_at", ASCENDING)],
        expireAfterSeconds=30 * 24 * 60 * 60, name="idx_rt_ttl",
    )

    # ── Usage buckets ──
    # Compound index for looking up a user's current/recent bucket quickly
    await _create_index(
        usage_buckets, [("user_id", ASCENDING), ("bucket_end", DESCENDING)],
        name="idx_usage_user_bucket",
    )
    # TTL: drop buckets 30 days after they end so we keep ~1 month of history
    await _create_index(
        usage_buckets, [("bucket_end", ASCENDING)],
        expireAfterSeconds=30 * 24 * 60 * 60, name="idx_usage_ttl",
    )

    # ── Service checks (status tracking) ──
    # Per-service time-series for the uptime page. Compound index powers
    # the "latest N checks per service" query; TTL purges after 90 days.
    await _create_index(
        service_checks, [("service", ASCENDING), ("checked_at", DESCENDING)],
        name="idx_service_checks_time",
    )
    await _create_index(
        service_checks, [("checked_at", ASCENDING)],
        expireAfterSeconds=90 * 24 * 60 * 60, name="idx_service_checks_ttl",
    )

    if critical_failures:
        raise RuntimeError(
            f"{critical_failures} critical index(es) failed to create. "
            "The app cannot guarantee data-integrity constraints. "
            "Fix the underlying issue (e.g. duplicate data) and restart."
        )

    _indexes_created = True
    logger.info("MongoDB indexes created successfully")


async def close_database() -> None:
    """Close the MongoDB connection."""
    global _client, _database, _indexes_created

    if _client is not None:
        _client.close()
        _client = None
        _database = None
        _indexes_created = False
