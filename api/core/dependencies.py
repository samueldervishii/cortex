import asyncio
import logging
import secrets
from typing import Optional

from fastapi import Header, HTTPException, status

from clients import LLMClient
from config import settings
from db import get_database, SessionRepository, SettingsRepository

logger = logging.getLogger("llm-council.security")

# Singleton instances — each repository/client is created once and reused.
# We use double-checked locking to prevent multiple concurrent requests from
# creating duplicate instances during startup: the outer `if None` check is
# fast (no lock), and the inner check under the lock guarantees only one
# coroutine actually initializes the singleton.
_llm_client: LLMClient | None = None
_session_repository: SessionRepository | None = None
_settings_repository: SettingsRepository | None = None
_init_lock = asyncio.Lock()


async def get_session_repository() -> SessionRepository:
    """Get the session repository dependency."""
    global _session_repository
    if _session_repository is None:
        async with _init_lock:
            if _session_repository is None:
                database = await get_database()
                _session_repository = SessionRepository(database)
    return _session_repository


async def get_settings_repository() -> SettingsRepository:
    """Get the settings repository dependency."""
    global _settings_repository
    if _settings_repository is None:
        async with _init_lock:
            if _settings_repository is None:
                database = await get_database()
                _settings_repository = SettingsRepository(database)
    return _settings_repository


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
) -> bool:
    """
    Verify API key for protected endpoints.

    API key must be provided via X-API-Key header.
    If no API key is configured in settings, authentication is disabled.
    """
    # If no API_KEY is configured, authentication is disabled entirely.
    # This is intentional for local development — returns True to allow all requests.
    if not settings.api_key:
        logger.warning(
            "API authentication is DISABLED (no API_KEY configured). "
            "All endpoints are publicly accessible. "
            "Set API_KEY in .env to enable authentication."
        )
        return True

    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required. Provide X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    if not secrets.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API key"
        )

    return True
