import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, status

from core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from core.dependencies import get_user_repository, get_current_user
from core.timestamps import utc_iso
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
from services.avatar import generate_avatar

logger = logging.getLogger("cortex.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_DURATION = 900  # 15 minutes in seconds


async def _check_lockout(email: str) -> None:
    """Check if account is locked out due to too many failed attempts.

    Uses MongoDB so lockout state survives restarts and is consistent
    across multiple workers.
    """
    from db.connection import get_database

    db = await get_database()
    col = db["login_attempts"]
    now = datetime.now(timezone.utc)

    doc = await col.find_one({"_id": email})
    if doc is None:
        return

    attempts = doc.get("attempts", [])
    cutoff = now.timestamp() - _LOCKOUT_DURATION
    recent = [t for t in attempts if t > cutoff]

    if len(recent) >= _MAX_FAILED_ATTEMPTS:
        oldest = min(recent)
        remaining = int(_LOCKOUT_DURATION - (now.timestamp() - oldest))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account temporarily locked due to too many failed attempts. Try again in {remaining // 60} minutes.",
        )


async def _record_failed_attempt(email: str) -> None:
    """Record a failed login attempt in MongoDB."""
    from db.connection import get_database

    db = await get_database()
    now = datetime.now(timezone.utc)
    cutoff = now.timestamp() - _LOCKOUT_DURATION

    await db["login_attempts"].update_one(
        {"_id": email},
        {
            "$push": {"attempts": {"$each": [now.timestamp()], "$slice": -_MAX_FAILED_ATTEMPTS * 2}},
            "$set": {"updated_at": now},
        },
        upsert=True,
    )


async def _clear_failed_attempts(email: str) -> None:
    """Clear failed attempts after successful login."""
    from db.connection import get_database

    db = await get_database()
    await db["login_attempts"].delete_one({"_id": email})


def _build_user_response(user: dict) -> UserResponse:
    """Build a UserResponse from a MongoDB user document."""
    return UserResponse(
        id=user["id"],
        email=user["email"],
        display_name=user.get("display_name", ""),
        username=user.get("username", ""),
        avatar=user.get("avatar", ""),
        field_of_work=user.get("field_of_work", ""),
        personal_preferences=user.get("personal_preferences", ""),
        created_at=utc_iso(user["created_at"]),
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    request: UserCreate,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
    _reg_limit: None = Depends(check_registration_limit),
):
    """Register a new user account."""
    from pymongo.errors import DuplicateKeyError

    existing = await user_repo.get_by_email(request.email)
    if existing:
        # Use generic error to prevent email enumeration
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration could not be completed. Please try again or use a different email.",
        )

    user_id = str(uuid.uuid4())
    hashed = await hash_password(request.password)
    avatar = generate_avatar(request.email)

    try:
        await user_repo.create(user_id, request.email, hashed, avatar=avatar)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration could not be completed. Please try again or use a different email.",
        )

    logger.info(f"New user registered: {user_id}")

    from db.connection import get_database
    db = await get_database()
    family_id = str(uuid.uuid4())
    jti = str(uuid.uuid4())
    await db["refresh_tokens"].insert_one({
        "family_id": family_id,
        "user_id": user_id,
        "current_jti": jti,
        "created_at": datetime.now(timezone.utc),
        "revoked": False,
    })

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id, family_id=family_id, jti=jti),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    request: UserLogin,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Authenticate and receive access + refresh tokens."""
    email_lower = request.email.lower()

    await _check_lockout(email_lower)

    user = await user_repo.get_by_email(request.email)

    if user:
        password_valid = await verify_password(request.password, user["hashed_password"])
    else:
        await verify_password(request.password, "$2b$12$LJ3m4ys3Lg2r6VCMkxZBOepAx0cjJkMBgPMCEID4jFl0Q5UuZkPmK")
        password_valid = False

    if not password_valid:
        await _record_failed_attempt(email_lower)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    await _clear_failed_attempts(email_lower)
    user_id = user["id"]
    logger.info("User logged in successfully")

    # Create the refresh token family in the DB at login time so that the
    # first /refresh call finds it already registered. This closes the
    # "first-refresh race" where a stolen token could register the family
    # before the legitimate user.
    from db.connection import get_database
    db = await get_database()
    family_id = str(uuid.uuid4())
    jti = str(uuid.uuid4())
    await db["refresh_tokens"].insert_one({
        "family_id": family_id,
        "user_id": user_id,
        "current_jti": jti,
        "created_at": datetime.now(timezone.utc),
        "revoked": False,
    })

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id, family_id=family_id, jti=jti),
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

    return _build_user_response(user)


@router.patch("/profile", response_model=UserResponse)
async def update_profile(
    request: ProfileUpdate,
    current_user_id: str = Depends(get_current_user),
    user_repo: UserRepository = Depends(get_user_repository),
):
    """Update the current user's profile."""
    from pymongo.errors import DuplicateKeyError

    # Check username uniqueness if provided
    if request.username:
        existing = await user_repo.get_by_username(request.username)
        if existing and existing["id"] != current_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username is not available",
            )

    try:
        user = await user_repo.update_profile(
            current_user_id,
            request.display_name,
            request.username,
            field_of_work=request.field_of_work,
            personal_preferences=request.personal_preferences,
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is not available",
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return _build_user_response(user)


@router.post("/avatar/regenerate", response_model=UserResponse)
async def regenerate_avatar(
    current_user_id: str = Depends(get_current_user),
    user_repo: UserRepository = Depends(get_user_repository),
):
    """Generate a new random avatar for the current user."""
    avatar = generate_avatar()  # Random seed
    user = await user_repo.update_avatar(current_user_id, avatar)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return _build_user_response(user)


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

    if not await verify_password(request.current_password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    await user_repo.update_password(current_user_id, await hash_password(request.new_password))

    # Revoke all refresh token families for this user
    from db.connection import get_database
    db = await get_database()
    await db["refresh_tokens"].update_many(
        {"user_id": current_user_id, "revoked": False},
        {"$set": {"revoked": True, "revoked_at": datetime.now(timezone.utc)}},
    )

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

    if not await verify_password(request.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password is incorrect",
        )

    await user_repo.delete(current_user_id)
    logger.info(f"User deleted account: {current_user_id}")
    return {"message": "Account deleted successfully"}


@router.get("/check-username/{username}")
async def check_username(
    username: str,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Check if a username is available."""
    if not username or len(username) < 3:
        return {"available": False, "reason": "Username must be at least 3 characters"}
    import re
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        return {"available": False, "reason": "Only letters, numbers, and underscores"}
    existing = await user_repo.get_by_username(username)
    return {"available": existing is None}


@router.get("/check-email/{email}")
async def check_email(
    email: str,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Validate email format.

    Always returns ``available: true`` for well-formed addresses to prevent
    account enumeration.  Actual uniqueness is enforced at registration time
    (backed by a unique DB index).
    """
    import re
    if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return {"available": False, "reason": "Invalid email format"}
    return {"available": True}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: RefreshRequest,
    user_repo: UserRepository = Depends(get_user_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Exchange a refresh token for a new access + refresh token pair.

    Implements token rotation: each refresh token can only be used once.
    Reusing an already-rotated token revokes the entire token family
    (indicates the token was stolen and replayed).
    """
    import uuid as _uuid
    from datetime import datetime, timezone
    from db.connection import get_database

    payload = decode_token(request.refresh_token, expected_type="refresh")
    user_id = payload["sub"]
    token_jti = payload.get("jti")
    token_family = payload.get("family")

    # Verify user still exists
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
        )

    # Reject refresh tokens issued before a password change
    token_iat = payload.get("iat")
    if token_iat and user.get("password_changed_at"):
        pwd_changed = user["password_changed_at"]
        if isinstance(pwd_changed, datetime):
            token_issued = datetime.fromtimestamp(token_iat, tz=timezone.utc)
            if token_issued < pwd_changed:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token invalidated by password change. Please log in again.",
                )

    db = await get_database()
    rt_col = db["refresh_tokens"]

    # Legacy tokens without family/jti: issue rotated tokens going forward
    if not token_family or not token_jti:
        new_family = str(_uuid.uuid4())
        new_jti = str(_uuid.uuid4())
        await rt_col.insert_one({
            "family_id": new_family,
            "user_id": user_id,
            "current_jti": new_jti,
            "created_at": datetime.now(timezone.utc),
            "revoked": False,
        })
        return TokenResponse(
            access_token=create_access_token(user_id),
            refresh_token=create_refresh_token(user_id, family_id=new_family, jti=new_jti),
        )

    # Look up the token family
    family_doc = await rt_col.find_one({"family_id": token_family, "user_id": user_id})

    if not family_doc:
        # Families are now pre-registered at login/register time.  A missing
        # family means the token was forged or belongs to an old session.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown token family. Please log in again.",
        )

    # Family is revoked — reject
    if family_doc.get("revoked"):
        logger.warning(f"Revoked token family reuse attempt: family={token_family} user={user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked. Please log in again.",
        )

    # Replay detection: if jti doesn't match current, this is a reused token
    if family_doc.get("current_jti") != token_jti:
        # Revoke the entire family — possible token theft
        await rt_col.update_one(
            {"family_id": token_family},
            {"$set": {"revoked": True, "revoked_at": datetime.now(timezone.utc)}},
        )
        logger.warning(f"Refresh token replay detected, family revoked: family={token_family} user={user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token reuse detected. All sessions for this login have been revoked. Please log in again.",
        )

    # Valid rotation: atomically update current_jti
    new_jti = str(_uuid.uuid4())
    result = await rt_col.update_one(
        {"family_id": token_family, "current_jti": token_jti, "revoked": False},
        {"$set": {"current_jti": new_jti}},
    )
    if result.modified_count == 0:
        # Concurrent rotation race — reject
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token already used. Please log in again.",
        )

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id, family_id=token_family, jti=new_jti),
    )


@router.post("/logout")
async def logout(
    request: RefreshRequest,
    current_user_id: str = Depends(get_current_user),
):
    """Revoke the current refresh token family so it can no longer be used.

    The access token remains valid until it expires (short-lived), but the
    refresh token is immediately unusable for rotation.
    """
    from db.connection import get_database

    payload = decode_token(request.refresh_token, expected_type="refresh")
    token_family = payload.get("family")

    if not token_family:
        return {"message": "Logged out"}

    db = await get_database()
    await db["refresh_tokens"].update_one(
        {"family_id": token_family, "user_id": current_user_id, "revoked": False},
        {"$set": {"revoked": True, "revoked_at": datetime.now(timezone.utc)}},
    )

    return {"message": "Logged out"}
