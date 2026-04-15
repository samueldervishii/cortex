import re
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from core.timestamps import utc_iso
from schemas import ChatSession

# Validate share tokens: alphanumeric, hyphens, underscores only
_SHARE_TOKEN_PATTERN = re.compile(r"^[a-zA-Z0-9\-_]+$")


class SessionRepository:
    """Repository for session persistence in MongoDB."""

    COLLECTION_NAME = "sessions"

    def __init__(self, database: AsyncIOMotorDatabase):
        self.collection = database[self.COLLECTION_NAME]

    async def create(self, session: ChatSession) -> ChatSession:
        """Create a new session in the database."""
        doc = session.model_dump()
        doc["created_at"] = datetime.now(timezone.utc)
        doc["updated_at"] = datetime.now(timezone.utc)
        await self.collection.insert_one(doc)
        return session

    async def get(
        self, session_id: str, include_deleted: bool = False, user_id: Optional[str] = None
    ) -> Optional[ChatSession]:
        """Get a session by ID, optionally scoped to a user."""
        query = {"id": session_id}
        if not include_deleted:
            query["is_deleted"] = {"$ne": True}
        if user_id is not None:
            query["user_id"] = user_id

        doc = await self.collection.find_one(query)
        if doc is None:
            return None
        return ChatSession(**doc)

    async def update(self, session: ChatSession) -> ChatSession:
        """
        Update an existing session with optimistic locking.

        Uses version field to prevent race conditions. If version doesn't match,
        it means another request modified the session - raises exception.

        Raises:
            ValueError: If session was modified by another request (version mismatch)
        """
        doc = session.model_dump()
        doc["updated_at"] = datetime.now(timezone.utc)

        # Get current version before update
        current_version = session.version

        # Increment version for next update
        new_version = current_version + 1
        doc["version"] = new_version

        # Update only if version matches (optimistic locking)
        result = await self.collection.update_one(
            {"id": session.id, "version": current_version},  # Match current version
            {"$set": doc},
        )

        # Check if update succeeded
        if result.matched_count == 0:
            # Version mismatch - someone else updated it
            raise ValueError(
                f"Session {session.id} was modified by another request. "
                "Please refresh and try again."
            )

        # Update the in-memory object with new version
        session.version = new_version
        return session

    # Shared $project stage used by the pinned + recent list queries so both
    # return identical SessionSummary-shaped documents.
    _SUMMARY_PROJECT_STAGE = {
        "$project": {
            "_id": 0,
            "id": 1,
            "title": 1,
            "created_at": 1,
            "is_pinned": {"$ifNull": ["$is_pinned", False]},
            "question": {
                "$ifNull": [
                    {"$arrayElemAt": [
                        {"$map": {
                            "input": {"$filter": {
                                "input": {"$ifNull": ["$messages", []]},
                                "cond": {"$eq": ["$$this.role", "user"]},
                            }},
                            "in": "$$this.content",
                        }},
                        0,
                    ]},
                    {"$ifNull": [{"$arrayElemAt": ["$rounds.question", 0]}, ""]},
                ]
            },
            "status": "completed",
            "message_count": {
                "$cond": {
                    "if": {"$isArray": "$messages"},
                    "then": {"$size": "$messages"},
                    "else": 0,
                }
            },
            "pinned_at": {"$ifNull": ["$pinned_at", None]},
        }
    }

    async def list_pinned(self, user_id: Optional[str] = None) -> List[dict]:
        """Return all pinned sessions for a user, newest-pinned first.

        Ghost sessions are excluded — they're persisted but hidden from history.
        """
        match_stage = {
            "is_deleted": {"$ne": True},
            "is_ghost": {"$ne": True},
            "is_pinned": True,
        }
        if user_id is not None:
            match_stage["user_id"] = user_id

        pipeline = [
            {"$match": match_stage},
            self._SUMMARY_PROJECT_STAGE,
            {"$sort": {"pinned_at": -1, "created_at": -1}},
            {"$project": {"pinned_at": 0}},
        ]

        sessions = []
        async for doc in self.collection.aggregate(pipeline):
            sessions.append(doc)
        return sessions

    async def list_recent_page(
        self, user_id: Optional[str] = None, limit: int = 5, offset: int = 0
    ) -> tuple[List[dict], int]:
        """Return a page of non-pinned sessions plus the total non-pinned count.

        Uses $facet so the page and the total are fetched in a single roundtrip.
        """
        match_stage = {
            "is_deleted": {"$ne": True},
            "is_ghost": {"$ne": True},
            "is_pinned": {"$ne": True},
        }
        if user_id is not None:
            match_stage["user_id"] = user_id

        pipeline = [
            {"$match": match_stage},
            {
                "$facet": {
                    "page": [
                        {"$sort": {"created_at": -1}},
                        {"$skip": offset},
                        {"$limit": limit},
                        self._SUMMARY_PROJECT_STAGE,
                        {"$project": {"pinned_at": 0}},
                    ],
                    "total": [{"$count": "count"}],
                }
            },
        ]

        cursor = self.collection.aggregate(pipeline)
        result = await cursor.to_list(length=1)
        if not result:
            return [], 0
        page = result[0].get("page", [])
        total_arr = result[0].get("total", [])
        total = total_arr[0]["count"] if total_arr else 0
        return page, total

    async def search(self, query: str, user_id: Optional[str] = None, limit: int = 20) -> List[dict]:
        """Search sessions by content (title, messages)."""
        # Escape regex metacharacters to prevent ReDoS attacks
        import re
        escaped_query = re.escape(query)
        regex = {"$regex": escaped_query, "$options": "i"}
        match_stage = {
            "is_deleted": {"$ne": True},
            "is_ghost": {"$ne": True},
            "$or": [
                {"title": regex},
                {"messages.content": regex},
                # Legacy support for old round-based sessions
                {"rounds.question": regex},
                {"rounds.responses.content": regex},
                {"rounds.chat_messages.content": regex},
            ],
        }
        if user_id is not None:
            match_stage["user_id"] = user_id

        pipeline = [
            {"$match": match_stage},
            {"$project": {
                "_id": 0,
                "id": 1,
                "title": 1,
                "created_at": 1,
                "is_pinned": {"$ifNull": ["$is_pinned", False]},
                "question": {"$ifNull": [
                    {"$arrayElemAt": [
                        {"$map": {
                            "input": {"$filter": {
                                "input": {"$ifNull": ["$messages", []]},
                                "cond": {"$eq": ["$$this.role", "user"]},
                            }},
                            "in": "$$this.content",
                        }},
                        0,
                    ]},
                    {"$ifNull": [{"$arrayElemAt": ["$rounds.question", 0]}, ""]},
                ]},
                "message_count": {
                    "$cond": {
                        "if": {"$isArray": "$messages"},
                        "then": {"$size": "$messages"},
                        "else": 0,
                    }
                },
            }},
            {"$sort": {"created_at": -1}},
            {"$limit": limit},
        ]

        results = []
        async for doc in self.collection.aggregate(pipeline):
            results.append(doc)
        return results

    async def soft_delete(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Soft delete a session by ID, optionally scoped to a user."""
        now = datetime.now(timezone.utc)
        query = {"id": session_id, "is_deleted": {"$ne": True}}
        if user_id is not None:
            query["user_id"] = user_id
        result = await self.collection.update_one(
            query,
            {
                "$set": {
                    "is_deleted": True,
                    "deleted_at": utc_iso(now),
                    "updated_at": now,
                }
            },
        )
        return result.modified_count > 0

    async def restore(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Restore a soft-deleted session, optionally scoped to a user."""
        query = {"id": session_id, "is_deleted": True}
        if user_id is not None:
            query["user_id"] = user_id
        result = await self.collection.update_one(
            query,
            {
                "$set": {
                    "is_deleted": False,
                    "deleted_at": None,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        return result.modified_count > 0

    async def hard_delete(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Permanently delete a session by ID, optionally scoped to a user."""
        query = {"id": session_id}
        if user_id is not None:
            query["user_id"] = user_id
        result = await self.collection.delete_one(query)
        return result.deleted_count > 0

    async def get_by_share_token(self, share_token: str) -> Optional[ChatSession]:
        """Get a shared session by its share token."""
        if not share_token or not _SHARE_TOKEN_PATTERN.match(share_token):
            return None

        doc = await self.collection.find_one(
            {"share_token": share_token, "is_shared": True, "is_deleted": {"$ne": True}}
        )
        if doc is None:
            return None
        return ChatSession(**doc)

    async def soft_delete_all(self, include_pinned: bool = False, user_id: Optional[str] = None) -> int:
        """
        Soft delete all sessions, optionally scoped to a user.
        Returns the count of deleted sessions.

        Args:
            include_pinned: If True, also delete pinned sessions. Default False (preserve pinned).
            user_id: If set, only delete sessions belonging to this user.
        """
        now = datetime.now(timezone.utc)
        query = {"is_deleted": {"$ne": True}}
        if user_id is not None:
            query["user_id"] = user_id

        if not include_pinned:
            query["is_pinned"] = {"$ne": True}

        result = await self.collection.update_many(
            query,
            {
                "$set": {
                    "is_deleted": True,
                    "deleted_at": utc_iso(now),
                    "updated_at": now,
                }
            },
        )
        return result.modified_count

    async def get_all_full(
        self, include_deleted: bool = False, limit: int = 1000, batch_size: int = 100,
        user_id: Optional[str] = None
    ) -> List[ChatSession]:
        """
        Get all sessions with full data (for export).
        Returns complete session objects including all rounds and responses.

        Args:
            include_deleted: Include soft-deleted sessions
            limit: Maximum number of sessions to return (default 1000, prevents memory issues)
            batch_size: MongoDB cursor batch size for efficient fetching
            user_id: If set, only return sessions belonging to this user.
        """
        query = {}
        if not include_deleted:
            query["is_deleted"] = {"$ne": True}
        if user_id is not None:
            query["user_id"] = user_id

        sessions = []
        cursor = (
            self.collection.find(query)
            .sort("created_at", -1)
            .limit(limit)
            .batch_size(batch_size)
        )

        async for doc in cursor:
            sessions.append(ChatSession(**doc))

        return sessions

    async def append_message(
        self, session_id: str, message_doc: dict, position: Optional[int] = None,
        user_id: Optional[str] = None,
    ) -> bool:
        """Append a message to a session without replacing the full document.
        This avoids overwriting concurrent mutations (pin, rename, delete, share).

        Args:
            position: If set, insert at this index instead of the end.
                      Used by stream completion to place the assistant reply
                      right after the user message it responded to.
            user_id: If set, the update only matches if the session belongs to
                     this user (defense-in-depth tenant isolation).
        """
        if position is not None:
            push_spec = {"$each": [message_doc], "$position": position}
        else:
            push_spec = message_doc
        query: dict = {"id": session_id, "is_deleted": {"$ne": True}}
        if user_id is not None:
            query["user_id"] = user_id
        result = await self.collection.update_one(
            query,
            {
                "$push": {"messages": push_spec},
                "$set": {"updated_at": datetime.now(timezone.utc)},
                "$inc": {"version": 1},
            },
        )
        return result.modified_count > 0

    async def replace_last_message(
        self, session_id: str, message_doc: dict, expected_count: int,
        user_id: Optional[str] = None,
    ) -> bool:
        """Replace the last message in a session (used for upload-with-replace).

        Atomically verifies that the message array still has exactly
        ``expected_count`` elements before replacing, so a concurrent
        append cannot cause the wrong message to be overwritten.
        """
        if expected_count <= 0:
            return False
        last_idx = expected_count - 1
        query: dict = {
            "id": session_id,
            "is_deleted": {"$ne": True},
            f"messages.{last_idx}": {"$exists": True},
            f"messages.{expected_count}": {"$exists": False},
        }
        if user_id is not None:
            query["user_id"] = user_id
        result = await self.collection.update_one(
            query,
            {
                "$set": {
                    f"messages.{last_idx}": message_doc,
                    "updated_at": datetime.now(timezone.utc),
                },
                "$inc": {"version": 1},
            },
        )
        return result.modified_count > 0

    async def update_pin(
        self, session_id: str, is_pinned: bool, pinned_at: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> bool:
        """Update the pinned status of a session with version increment."""
        update_fields = {
            "is_pinned": is_pinned,
            "pinned_at": pinned_at,
            "updated_at": datetime.now(timezone.utc),
        }
        query = {"id": session_id, "is_deleted": {"$ne": True}}
        if user_id is not None:
            query["user_id"] = user_id
        result = await self.collection.update_one(
            query,
            {"$set": update_fields, "$inc": {"version": 1}},
        )
        return result.modified_count > 0


    async def soft_delete_older_than(
        self, days: int, include_pinned: bool = False, user_id: Optional[str] = None
    ) -> int:
        """Soft delete sessions older than the specified number of days."""
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        now = datetime.now(timezone.utc)

        query = {
            "is_deleted": {"$ne": True},
            "created_at": {"$lt": cutoff_date},
            "updated_at": {"$lt": cutoff_date},
        }

        if user_id is not None:
            query["user_id"] = user_id

        if not include_pinned:
            query["is_pinned"] = {"$ne": True}

        result = await self.collection.update_many(
            query,
            {
                "$set": {
                    "is_deleted": True,
                    "deleted_at": utc_iso(now),
                    "updated_at": now,
                    "auto_deleted": True,
                }
            },
        )
        return result.modified_count

    async def purge_older_than(
        self, days: int, include_pinned: bool = False, user_id: Optional[str] = None
    ) -> int:
        """Hard-delete sessions and all associated data older than *days*.

        Removes session documents, artifacts, sources, file blobs, and
        feedback.  Used by auto-delete so user data is actually purged,
        not just hidden.

        The final session delete re-applies the time filter so a session
        that was updated between the ID scan and the delete is not lost.
        """
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

        query: dict = {
            "is_deleted": {"$ne": True},
            "created_at": {"$lt": cutoff_date},
            "updated_at": {"$lt": cutoff_date},
        }
        if user_id is not None:
            query["user_id"] = user_id
        if not include_pinned:
            query["is_pinned"] = {"$ne": True}

        session_ids: List[str] = []
        async for doc in self.collection.find(query, {"id": 1}):
            session_ids.append(doc["id"])

        if not session_ids:
            return 0

        import asyncio
        db = self.collection.database
        id_filter = {"session_id": {"$in": session_ids}}
        await asyncio.gather(
            db["artifacts"].delete_many(id_filter),
            db["sources"].delete_many(id_filter),
            db["file_storage"].delete_many(id_filter),
            db["feedback"].delete_many(id_filter),
        )

        # Re-check the time predicate so sessions revived by user activity
        # between the scan and this point are not accidentally deleted.
        safe_filter = {
            "id": {"$in": session_ids},
            "updated_at": {"$lt": cutoff_date},
        }
        result = await self.collection.delete_many(safe_filter)
        return result.deleted_count
