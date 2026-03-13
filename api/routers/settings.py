from typing import List
from fastapi import APIRouter, Depends

from core.dependencies import get_settings_repository, verify_api_key
from db import SettingsRepository
from schemas import UserSettingsUpdate, UserSettingsResponse
from constants.beta_features import get_beta_features_info, BetaFeatureInfo

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=UserSettingsResponse)
async def get_settings(repo: SettingsRepository = Depends(get_settings_repository)):
    """
    Get User Settings

    Retrieves the current user settings and preferences.
    Returns default settings if none have been configured.
    """
    settings = await repo.get(user_id="default")
    return UserSettingsResponse(settings=settings, message="Settings retrieved")


@router.patch("", response_model=UserSettingsResponse)
async def update_settings(
    request: UserSettingsUpdate,
    repo: SettingsRepository = Depends(get_settings_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Update User Settings

    Updates user settings and preferences. Only provided fields will be updated.
    All fields are optional.

    **Settings:**
    - **auto_delete_days**: Auto-delete sessions older than X days (30, 60, 90, or null)
    - **beta_features_enabled**: Access experimental features
    """
    # Get current settings
    current_settings = await repo.get(user_id="default")

    # Update only provided fields
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_settings, field, value)

    # Save updated settings
    updated_settings = await repo.update(current_settings)

    return UserSettingsResponse(
        settings=updated_settings, message="Settings updated successfully"
    )


@router.delete("")
async def reset_settings(
    repo: SettingsRepository = Depends(get_settings_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Reset Settings to Defaults

    Deletes all user settings and reverts to default values.
    """
    await repo.delete(user_id="default")
    return {"message": "Settings reset to defaults"}


@router.get("/beta-features", response_model=List[BetaFeatureInfo])
async def get_available_beta_features():
    """
    Get Available Beta Features

    Returns a list of all available beta features that users can opt into.
    Each feature includes its ID, name, description, and current status.
    """
    return get_beta_features_info()
