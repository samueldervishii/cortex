"""One-time data migrations run at startup.

Each migration is idempotent — safe to run multiple times.
"""

import logging
import uuid

from motor.motor_asyncio import AsyncIOMotorDatabase

from core.timestamps import utc_iso

logger = logging.getLogger("etude.migrations")


async def migrate_inline_file_data(database: AsyncIOMotorDatabase) -> int:
    """Move inline data_base64 from session messages to the file_storage collection.

    Finds messages that have a non-empty data_base64 but no file_storage_id,
    copies the blob to file_storage, updates the message to reference it,
    and clears the inline field.

    Returns the number of messages migrated.
    """
    sessions_col = database["sessions"]
    storage_col = database["file_storage"]
    migrated = 0

    # Find sessions that still have inline file data.
    # We look for messages where data_base64 is a non-empty string and
    # file_storage_id is absent or null.
    cursor = sessions_col.find(
        {
            "messages": {
                "$elemMatch": {
                    "file.data_base64": {"$exists": True, "$ne": ""},
                    "file.file_storage_id": {"$in": [None, ""]},
                }
            }
        },
        {"id": 1, "messages": 1},
    ).batch_size(50)

    async for doc in cursor:
        session_id = doc["id"]
        messages = doc.get("messages", [])
        updates = {}

        for idx, msg in enumerate(messages):
            file_data = msg.get("file")
            if not file_data:
                continue
            b64 = file_data.get("data_base64", "")
            existing_ref = file_data.get("file_storage_id")
            if not b64 or existing_ref:
                continue

            # Store in file_storage
            storage_id = str(uuid.uuid4())
            await storage_col.insert_one({
                "id": storage_id,
                "session_id": session_id,
                "data_base64": b64,
                "filename": file_data.get("filename", ""),
                "content_type": file_data.get("content_type", ""),
                "size": file_data.get("size", 0),
                "created_at": utc_iso(),
            })

            # Queue update: set file_storage_id, clear data_base64
            updates[f"messages.{idx}.file.file_storage_id"] = storage_id
            updates[f"messages.{idx}.file.data_base64"] = ""
            migrated += 1

        if updates:
            await sessions_col.update_one(
                {"id": session_id},
                {"$set": updates},
            )

    if migrated > 0:
        logger.info(f"Migration: moved {migrated} inline file blobs to file_storage")

    return migrated


async def run_all_migrations(database: AsyncIOMotorDatabase) -> None:
    """Run all pending migrations. Called once at startup."""
    await migrate_inline_file_data(database)
