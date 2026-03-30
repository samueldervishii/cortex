from fastapi import APIRouter, Depends

from core.dependencies import get_settings_repository, get_current_user
from db import SettingsRepository
from schemas import UserSettingsUpdate, UserSettingsResponse

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=UserSettingsResponse)
async def get_settings(
    repo: SettingsRepository = Depends(get_settings_repository),
    user_id: str = Depends(get_current_user),
):
    """Get user settings."""
    settings = await repo.get(user_id=user_id)
    return UserSettingsResponse(settings=settings, message="Settings retrieved")


@router.patch("", response_model=UserSettingsResponse)
async def update_settings(
    request: UserSettingsUpdate,
    repo: SettingsRepository = Depends(get_settings_repository),
    user_id: str = Depends(get_current_user),
):
    """Update user settings."""
    current_settings = await repo.get(user_id=user_id)
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_settings, field, value)
    updated_settings = await repo.update(current_settings)
    return UserSettingsResponse(settings=updated_settings, message="Settings updated")


@router.delete("")
async def reset_settings(
    repo: SettingsRepository = Depends(get_settings_repository),
    user_id: str = Depends(get_current_user),
):
    """Reset settings to defaults."""
    await repo.delete(user_id=user_id)
    return {"message": "Settings reset to defaults"}
