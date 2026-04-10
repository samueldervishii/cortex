from fastapi import APIRouter, Depends, Query

from core.dependencies import get_current_user
from db import get_database
from services import usage_service

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/current")
async def get_current_usage(user_id: str = Depends(get_current_user)):
    """Return the user's active 5-hour usage bucket.

    If the user has no active bucket (idle or brand new), returns zeroed
    counters — a bucket is only created on first activity.
    """
    db = await get_database()
    usage = await usage_service.get_current_usage(db, user_id)
    return {"usage": usage}


@router.get("/history")
async def get_usage_history(
    days: int = Query(default=30, ge=1, le=90),
    user_id: str = Depends(get_current_user),
):
    """Aggregate the user's activity over the last N days (default 30)."""
    db = await get_database()
    history = await usage_service.get_usage_history(db, user_id, days=days)
    return {"history": history}
