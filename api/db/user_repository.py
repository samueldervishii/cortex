from datetime import datetime, timezone
from typing import Optional


class UserRepository:
    def __init__(self, database):
        self.collection = database["users"]

    async def create(self, user_id: str, email: str, hashed_password: str) -> dict:
        doc = {
            "id": user_id,
            "email": email.lower(),
            "hashed_password": hashed_password,
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

    async def update_profile(self, user_id: str, display_name: str, username: str) -> Optional[dict]:
        result = await self.collection.find_one_and_update(
            {"id": user_id},
            {"$set": {"display_name": display_name, "username": username.lower()}},
            return_document=True,
        )
        return result

    async def update_password(self, user_id: str, hashed_password: str) -> bool:
        result = await self.collection.update_one(
            {"id": user_id}, {"$set": {"hashed_password": hashed_password}}
        )
        return result.modified_count > 0

    async def delete(self, user_id: str) -> bool:
        result = await self.collection.delete_one({"id": user_id})
        return result.deleted_count > 0
