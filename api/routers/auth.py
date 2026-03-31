import logging
import time
import uuid
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Depends, status

from core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from core.dependencies import get_user_repository, get_current_user
from core.rate_limit import check_rate_limit, check_registration_limit
from db.user_repository import UserRepository
from schemas.user import (
    UserCreate,
    UserLogin,
    UserResponse,
    TokenResponse,
    RefreshRequest,
    ProfileUpdate,
    PasswordChange,
    DeleteAccount,
)

logger = logging.getLogger("cortex.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

# Account lockout: track failed login attempts per email
_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_DURATION = 900  # 15 minutes in seconds
_failed_attempts: dict[str, list[float]] = defaultdict(list)


def _check_lockout(email: str) -> None:
    """Check if account is locked out due to too many failed attempts."""
    now = time.time()
    # Clean old attempts
    _failed_attempts[email] = [t for t in _failed_attempts[email] if now - t < _LOCKOUT_DURATION]
    if len(_failed_attempts[email]) >= _MAX_FAILED_ATTEMPTS:
        remaining = int(_LOCKOUT_DURATION - (now - _failed_attempts[email][0]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account temporarily locked due to too many failed attempts. Try again in {remaining // 60} minutes.",
        )


def _record_failed_attempt(email: str) -> None:
    """Record a failed login attempt."""
    _failed_attempts[email].append(time.time())


def _clear_failed_attempts(email: str) -> None:
    """Clear failed attempts after successful login."""
    _failed_attempts.pop(email, None)


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    request: UserCreate,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
    _reg_limit: None = Depends(check_registration_limit),
):
    """Register a new user account."""
    existing = await user_repo.get_by_email(request.email)
    if existing:
        # Use generic error to prevent email enumeration
        # (attacker can't determine if an email is registered)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration could not be completed. Please try again or use a different email.",
        )

    user_id = str(uuid.uuid4())
    hashed = hash_password(request.password)
    await user_repo.create(user_id, request.email, hashed)

    logger.info(f"New user registered: {user_id}")

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    request: UserLogin,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Authenticate and receive access + refresh tokens."""
    email_lower = request.email.lower()

    # Check lockout before doing any work
    _check_lockout(email_lower)

    user = await user_repo.get_by_email(request.email)

    # Always run bcrypt to prevent timing-based email enumeration
    if user:
        password_valid = verify_password(request.password, user["hashed_password"])
    else:
        # Dummy verify to consume constant time even when user doesn't exist
        verify_password(request.password, "$2b$12$LJ3m4ys3Lg2r6VCMkxZBOepAx0cjJkMBgPMCEID4jFl0Q5UuZkPmK")
        password_valid = False

    if not password_valid:
        _record_failed_attempt(email_lower)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    _clear_failed_attempts(email_lower)
    user_id = user["id"]
    logger.info("User logged in successfully")

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user_id: str = Depends(get_current_user),
    user_repo: UserRepository = Depends(get_user_repository),
):
    """Get the current authenticated user's profile."""
    user = await user_repo.get_by_id(current_user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse(
        id=user["id"],
        email=user["email"],
        display_name=user.get("display_name", ""),
        username=user.get("username", ""),
        created_at=user["created_at"].isoformat() + "Z",
    )


@router.patch("/profile", response_model=UserResponse)
async def update_profile(
    request: ProfileUpdate,
    current_user_id: str = Depends(get_current_user),
    user_repo: UserRepository = Depends(get_user_repository),
):
    """Update the current user's profile (display name, username)."""
    # Check username uniqueness if provided
    if request.username:
        existing = await user_repo.get_by_username(request.username)
        if existing and existing["id"] != current_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username is not available",
            )

    user = await user_repo.update_profile(
        current_user_id, request.display_name, request.username
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse(
        id=user["id"],
        email=user["email"],
        display_name=user.get("display_name", ""),
        username=user.get("username", ""),
        created_at=user["created_at"].isoformat() + "Z",
    )


@router.post("/change-password")
async def change_password(
    request: PasswordChange,
    current_user_id: str = Depends(get_current_user),
    user_repo: UserRepository = Depends(get_user_repository),
):
    """Change the current user's password."""
    user = await user_repo.get_by_id(current_user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not verify_password(request.current_password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    await user_repo.update_password(current_user_id, hash_password(request.new_password))
    logger.info(f"User changed password: {current_user_id}")
    return {"message": "Password changed successfully"}


@router.delete("/account")
async def delete_account(
    request: DeleteAccount,
    current_user_id: str = Depends(get_current_user),
    user_repo: UserRepository = Depends(get_user_repository),
):
    """Permanently delete the current user's account."""
    user = await user_repo.get_by_id(current_user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not verify_password(request.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password is incorrect",
        )

    await user_repo.delete(current_user_id)
    logger.info(f"User deleted account: {current_user_id}")
    return {"message": "Account deleted successfully"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: RefreshRequest,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Exchange a refresh token for a new access + refresh token pair."""
    payload = decode_token(request.refresh_token, expected_type="refresh")
    user_id = payload["sub"]

    # Verify user still exists
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
        )

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )
