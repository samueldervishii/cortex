from typing import Optional
from pydantic import BaseModel, Field


class UserSettings(BaseModel):
    """User preferences and settings."""

    user_id: str = Field(default="default")

    # Data & Privacy
    auto_delete_days: Optional[int] = Field(
        default=None,
        description="Auto-delete sessions older than X days. Options: 30, 60, 90",
    )


class UserSettingsUpdate(BaseModel):
    """Request to update user settings."""

    auto_delete_days: Optional[int] = Field(
        None,
        description="Auto-delete sessions older than X days. Options: 30, 60, 90, or null",
    )


class UserSettingsResponse(BaseModel):
    """Response containing user settings."""

    settings: UserSettings
    message: str
