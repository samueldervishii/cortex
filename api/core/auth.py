import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import HTTPException, status
from jose import JWTError, jwt

from config import settings

logger = logging.getLogger("etude.auth")


def _check_jwt_secret():
    """Validate JWT secret key at first use."""
    if not settings.jwt_secret_key or len(settings.jwt_secret_key) < 32:
        raise ValueError(
            "JWT_SECRET_KEY is missing or too short (min 32 chars). "
            "Generate one with: openssl rand -hex 32"
        )


def _hash_password_sync(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password_sync(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


async def hash_password(password: str) -> str:
    """Hash a password using bcrypt, offloaded to a thread to avoid blocking the event loop."""
    return await asyncio.to_thread(_hash_password_sync, password)


async def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a bcrypt hash, offloaded to a thread."""
    return await asyncio.to_thread(_verify_password_sync, plain_password, hashed_password)


def create_access_token(user_id: str) -> str:
    _check_jwt_secret()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {"sub": user_id, "exp": expire, "iat": now, "type": "access"}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, family_id: str | None = None, jti: str | None = None) -> str:
    """Create a refresh JWT.

    Args:
        family_id: Token family identifier for rotation tracking.
                   A new family is created per login; all rotated tokens share it.
        jti: Unique token ID. Generated if not provided.
    """
    _check_jwt_secret()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.jwt_refresh_token_expire_days)
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": now,
        "type": "refresh",
        "jti": jti or str(uuid.uuid4()),
        "family": family_id or str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: str = "access") -> dict:
    """Decode and validate a JWT token. Returns the payload dict with 'sub' (user_id)."""
    _check_jwt_secret()
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        user_id: str = payload.get("sub")
        token_type: str = payload.get("type")
        if user_id is None or token_type != expected_type:
            raise credentials_exception
        return payload
    except JWTError:
        raise credentials_exception
