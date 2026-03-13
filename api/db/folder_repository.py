from datetime import datetime, timezone
from typing import List, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from schemas import Folder


class FolderRepository:
    """Repository for folder persistence in MongoDB."""

    COLLECTION_NAME = "folders"

    def __init__(self, database: AsyncIOMotorDatabase):
        self.collection = database[self.COLLECTION_NAME]

    async def create(self, folder: Folder) -> Folder:
        """Create a new folder in the database."""
        doc = folder.model_dump()
        doc["created_at"] = datetime.now(timezone.utc)
        doc["updated_at"] = datetime.now(timezone.utc)
        await self.collection.insert_one(doc)
        return folder

    async def get(self, folder_id: str) -> Optional[Folder]:
        """Get a folder by ID."""
        doc = await self.collection.find_one({"id": folder_id})
        if doc is None:
            return None
        return Folder(**doc)

    async def update(self, folder: Folder) -> Folder:
        """Update an existing folder."""
        doc = folder.model_dump()
        doc["updated_at"] = datetime.now(timezone.utc)

        await self.collection.update_one({"id": folder.id}, {"$set": doc})
        return folder

    async def delete(self, folder_id: str) -> bool:
        """Delete a folder by ID."""
        result = await self.collection.delete_one({"id": folder_id})
        return result.deleted_count > 0

    async def list_all(self) -> List[Folder]:
        """List all folders ordered by position."""
        folders = []
        async for doc in self.collection.find().sort("position", 1):
            folders.append(Folder(**doc))
        return folders

    async def get_next_position(self) -> int:
        """Get the next available position for a new folder."""
        doc = await self.collection.find_one(
            {}, sort=[("position", -1)], projection={"position": 1}
        )
        if doc is None:
            return 0
        return doc.get("position", 0) + 1

    async def reorder(self, folder_ids: List[str]) -> None:
        """Reorder folders based on the provided list of IDs."""
        for position, folder_id in enumerate(folder_ids):
            await self.collection.update_one(
                {"id": folder_id},
                {
                    "$set": {
                        "position": position,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
