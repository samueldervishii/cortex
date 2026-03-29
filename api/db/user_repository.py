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
