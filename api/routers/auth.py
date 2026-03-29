import logging
import uuid

from fastapi import APIRouter, HTTPException, Depends, status

from core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from core.dependencies import get_user_repository, get_current_user
from core.rate_limit import check_rate_limit
from db.user_repository import UserRepository
from schemas.user import (
    UserCreate,
    UserLogin,
    UserResponse,
    TokenResponse,
    RefreshRequest,
)

logger = logging.getLogger("llm-council.auth")

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    request: UserCreate,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Register a new user account."""
    existing = await user_repo.get_by_email(request.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    user_id = str(uuid.uuid4())
    hashed = hash_password(request.password)
    await user_repo.create(user_id, request.email, hashed)

    logger.info(f"New user registered: {request.email}")

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
    user = await user_repo.get_by_email(request.email)

    # Always run bcrypt to prevent timing-based email enumeration
    if user:
        password_valid = verify_password(request.password, user["hashed_password"])
    else:
        # Dummy verify to consume constant time even when user doesn't exist
        verify_password(request.password, "$2b$12$LJ3m4ys3Lg2r6VCMkxZBOepAx0cjJkMBgPMCEID4jFl0Q5UuZkPmK")
        password_valid = False

    if not password_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    user_id = user["id"]
    logger.info(f"User logged in: {request.email}")

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
        created_at=user["created_at"].isoformat(),
    )


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
