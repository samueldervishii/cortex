from fastapi import APIRouter, HTTPException, Depends

from core.dependencies import get_session_repository
from core.rate_limit import check_rate_limit
from db import SessionRepository
from schemas import SessionResponse

router = APIRouter(prefix="/shared", tags=["shared"])


@router.get("/{share_token}", response_model=SessionResponse)
async def get_shared_session(
    share_token: str,
    repo: SessionRepository = Depends(get_session_repository),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Get Shared Session (Public)

    Retrieves a session using its share token. This is a public endpoint
    that does not require authentication.

    Returns the full session data in read-only mode.
    """
    session = await repo.get_by_share_token(share_token)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Shared session not found or sharing has been revoked",
        )

    return SessionResponse(session=session, message="Shared session retrieved")
