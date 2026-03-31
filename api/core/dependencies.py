import asyncio
import logging
import secrets
from typing import Optional

from fastapi import Header, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from clients import AIClient
from config import settings
from core.auth import decode_token
from db import get_database, SessionRepository, SettingsRepository
from db.user_repository import UserRepository

logger = logging.getLogger("cortex.security")

_bearer_scheme = HTTPBearer()

# Singleton instances — each repository/client is created once and reused.
# We use double-checked locking to prevent multiple concurrent requests from
# creating duplicate instances during startup: the outer `if None` check is
# fast (no lock), and the inner check under the lock guarantees only one
# coroutine actually initializes the singleton.
_ai_client: AIClient | None = None
_session_repository: SessionRepository | None = None
_settings_repository: SettingsRepository | None = None
_user_repository: UserRepository | None = None
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


async def get_user_repository() -> UserRepository:
    """Get the user repository dependency."""
    global _user_repository
    if _user_repository is None:
        async with _init_lock:
            if _user_repository is None:
                database = await get_database()
                _user_repository = UserRepository(database)
    return _user_repository


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> str:
    """Extract and validate the current user from the JWT Bearer token.
    Checks that token was issued after any password change.
    Returns the user_id string."""
    from datetime import datetime, timezone

    payload = decode_token(credentials.credentials, expected_type="access")
    user_id = payload["sub"]

    # Check if token was issued before a password change
    token_iat = payload.get("iat")
    if token_iat:
        user_repo = await get_user_repository()
        user = await user_repo.get_by_id(user_id)
        if user and user.get("password_changed_at"):
            pwd_changed = user["password_changed_at"]
            if isinstance(pwd_changed, datetime):
                token_issued = datetime.fromtimestamp(token_iat, tz=timezone.utc)
                if token_issued < pwd_changed:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Token invalidated by password change. Please log in again.",
                        headers={"WWW-Authenticate": "Bearer"},
                    )

    return user_id


def get_ai_client() -> AIClient:
    """Get the LLM client dependency."""
    global _ai_client
    if _ai_client is None:
        _ai_client = AIClient()
    return _ai_client


async def close_ai_client() -> None:
    """Close the LLM client and cleanup resources."""
    global _ai_client
    if _ai_client is not None:
        await _ai_client.close()
        _ai_client = None


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
