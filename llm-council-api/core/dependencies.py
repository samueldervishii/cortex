import logging
import secrets
from typing import Optional

from fastapi import Header, HTTPException, Query, status

from clients import LLMClient
from config import settings
from db import get_database, SessionRepository, SettingsRepository
from db.folder_repository import FolderRepository

logger = logging.getLogger("llm-council.security")

# Singleton client instance
_llm_client: LLMClient | None = None
_session_repository: SessionRepository | None = None
_settings_repository: SettingsRepository | None = None
_folder_repository: FolderRepository | None = None


async def get_session_repository() -> SessionRepository:
    """Get the session repository dependency."""
    global _session_repository
    if _session_repository is None:
        database = await get_database()
        _session_repository = SessionRepository(database)
    return _session_repository


async def get_settings_repository() -> SettingsRepository:
    """Get the settings repository dependency."""
    global _settings_repository
    if _settings_repository is None:
        database = await get_database()
        _settings_repository = SettingsRepository(database)
    return _settings_repository


async def get_folder_repository() -> FolderRepository:
    """Get the folder repository dependency."""
    global _folder_repository
    if _folder_repository is None:
        database = await get_database()
        _folder_repository = FolderRepository(database)
    return _folder_repository


def get_llm_client() -> LLMClient:
    """Get the LLM client dependency."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client


async def close_llm_client() -> None:
    """Close the LLM client and cleanup resources."""
    global _llm_client
    if _llm_client is not None:
        await _llm_client.close()
        _llm_client = None


async def verify_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    api_key: Optional[str] = Query(None, alias="api_key"),
) -> bool:
    """
    Verify API key for protected endpoints.

    API key can be provided via:
    - X-API-Key header (recommended)
    - api_key query parameter (for testing)

    If no API key is configured in settings, authentication is disabled.
    """
    if not settings.api_key:
        logger.warning(
            "API authentication is DISABLED (no API_KEY configured). "
            "All endpoints are publicly accessible. "
            "Set API_KEY in .env to enable authentication."
        )
        return True

    provided_key = x_api_key or api_key

    if not provided_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required. Provide X-API-Key header or api_key query parameter.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    if not secrets.compare_digest(provided_key, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API key"
        )

    return True
