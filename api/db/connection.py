import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from config import settings

logger = logging.getLogger("llm-council.db")

_client: AsyncIOMotorClient | None = None
_database: AsyncIOMotorDatabase | None = None
_indexes_created: bool = False


async def get_database() -> AsyncIOMotorDatabase:
    """Get the MongoDB database instance."""
    global _client, _database

    if _database is None:
        _client = AsyncIOMotorClient(
            settings.mongodb_url,
            maxPoolSize=20,  # Maximum connections in the pool
            minPoolSize=5,  # Minimum connections to maintain
            maxIdleTimeMS=30000,  # Close idle connections after 30 seconds
            connectTimeoutMS=10000,  # Connection timeout: 10 seconds
            serverSelectionTimeoutMS=10000,  # Server selection timeout: 10 seconds
            retryWrites=True,  # Retry failed writes
            retryReads=True,  # Retry failed reads
        )
        _database = _client[settings.mongodb_database]

    return _database


async def ensure_indexes(database: AsyncIOMotorDatabase) -> None:
    """Create indexes for optimal query performance."""
    global _indexes_created

    if _indexes_created:
        return

    sessions_collection = database["sessions"]
    settings_collection = database["user_settings"]

    try:
        # Sessions indexes
        # Index for session lookup by ID (most common query)
        await sessions_collection.create_index(
            [("id", ASCENDING)], unique=True, name="idx_session_id"
        )

        # Index for shared session lookup by token
        await sessions_collection.create_index(
            [("share_token", ASCENDING)],
            sparse=True,  # Only index documents with share_token
            name="idx_share_token",
        )

        # Compound index for listing sessions (filtered by is_deleted, sorted by created_at)
        await sessions_collection.create_index(
            [("is_deleted", ASCENDING), ("created_at", DESCENDING)],
            name="idx_list_sessions",
        )

        # Index for pinned sessions
        await sessions_collection.create_index(
            [("is_pinned", ASCENDING), ("pinned_at", DESCENDING)],
            sparse=True,
            name="idx_pinned_sessions",
        )

        # User settings indexes
        # Index for user_id lookup
        await settings_collection.create_index(
            [("user_id", ASCENDING)], unique=True, name="idx_user_id"
        )

        _indexes_created = True
        logger.info("MongoDB indexes created successfully")

    except Exception as e:
        logger.warning(f"Failed to create indexes (may already exist): {e}")
        _indexes_created = True  # Don't retry on every request


async def close_database() -> None:
    """Close the MongoDB connection."""
    global _client, _database, _indexes_created

    if _client is not None:
        _client.close()
        _client = None
        _database = None
        _indexes_created = False
