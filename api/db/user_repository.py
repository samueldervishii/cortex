from datetime import datetime, timezone
from typing import Optional


class UserRepository:
    def __init__(self, database):
        self.collection = database["users"]

    async def create(self, user_id: str, email: str, hashed_password: str, avatar: str = "") -> dict:
        doc = {
            "id": user_id,
            "email": email.lower(),
            "hashed_password": hashed_password,
            "avatar": avatar,
            "field_of_work": "",
            "personal_preferences": "",
            "created_at": datetime.now(timezone.utc),
        }
        await self.collection.insert_one(doc)
        return doc

    async def get_by_email(self, email: str) -> Optional[dict]:
        return await self.collection.find_one({"email": email.lower()})

    async def get_by_id(self, user_id: str) -> Optional[dict]:
        return await self.collection.find_one({"id": user_id})

    async def get_by_username(self, username: str) -> Optional[dict]:
        return await self.collection.find_one({"username": username.lower()})

    async def update_profile(
        self,
        user_id: str,
        display_name: str,
        username: str,
        field_of_work: str = "",
        personal_preferences: str = "",
    ) -> Optional[dict]:
        result = await self.collection.find_one_and_update(
            {"id": user_id},
            {"$set": {
                "display_name": display_name,
                "username": username.lower(),
                "field_of_work": field_of_work,
                "personal_preferences": personal_preferences,
            }},
            return_document=True,
        )
        return result

    async def update_avatar(self, user_id: str, avatar: str) -> Optional[dict]:
        result = await self.collection.find_one_and_update(
            {"id": user_id},
            {"$set": {"avatar": avatar}},
            return_document=True,
        )
        return result

    async def update_password(self, user_id: str, hashed_password: str) -> bool:
        result = await self.collection.update_one(
            {"id": user_id},
            {"$set": {
                "hashed_password": hashed_password,
                "password_changed_at": datetime.now(timezone.utc),
            }},
        )
        return result.modified_count > 0

    async def delete(self, user_id: str) -> bool:
        """Delete user and all associated data (sessions, settings, feedback, artifacts)."""
        db = self.collection.database
        # Get session IDs for artifact cleanup
        session_ids = []
        async for doc in db["sessions"].find({"user_id": user_id}, {"id": 1}):
            session_ids.append(doc["id"])
        if session_ids:
            await db["artifacts"].delete_many({"session_id": {"$in": session_ids}})
            await db["sources"].delete_many({"session_id": {"$in": session_ids}})
            await db["file_storage"].delete_many({"session_id": {"$in": session_ids}})
        # Remove all user data
        await db["sessions"].delete_many({"user_id": user_id})
        await db["user_settings"].delete_many({"user_id": user_id})
        await db["feedback"].delete_many({"user_id": user_id})
        await db["refresh_tokens"].delete_many({"user_id": user_id})
        result = await self.collection.delete_one({"id": user_id})
        return result.deleted_count > 0
