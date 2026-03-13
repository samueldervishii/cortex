from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from schemas import UserSettings


class SettingsRepository:
    """Repository for user settings persistence in MongoDB."""

    COLLECTION_NAME = "user_settings"

    def __init__(self, database: AsyncIOMotorDatabase):
        self.collection = database[self.COLLECTION_NAME]

    async def get(self, user_id: str = "default") -> UserSettings:
        """
        Get user settings by user_id.
        Returns default settings if none exist.
        """
        doc = await self.collection.find_one({"user_id": user_id})
        if doc is None:
            # Return default settings
            return UserSettings(user_id=user_id)
        return UserSettings(**doc)

    async def update(self, settings: UserSettings) -> UserSettings:
        """
        Update user settings.
        Creates the document if it doesn't exist (upsert).
        """
        doc = settings.model_dump()
        doc["updated_at"] = datetime.now(timezone.utc)

        await self.collection.update_one(
            {"user_id": settings.user_id}, {"$set": doc}, upsert=True
        )
        return settings

    async def delete(self, user_id: str = "default") -> bool:
        """Delete user settings (reset to defaults)."""
        result = await self.collection.delete_one({"user_id": user_id})
        return result.deleted_count > 0
