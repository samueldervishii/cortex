from typing import Literal, Optional, Union
from pydantic import BaseModel, Field

# Only these values are valid for auto-deletion.
AutoDeleteDays = Literal[30, 60, 90]


class UserSettings(BaseModel):
    """User preferences and settings."""

    user_id: str = Field(default="default")

    auto_delete_days: Optional[AutoDeleteDays] = Field(
        default=None,
        description="Auto-delete sessions older than X days. Options: 30, 60, 90",
    )



class UserSettingsUpdate(BaseModel):
    """Request to update user settings."""

    auto_delete_days: Union[AutoDeleteDays, None] = Field(
        None,
        description="Auto-delete sessions older than X days. Options: 30, 60, 90, or null",
    )


class UserSettingsResponse(BaseModel):
    """Response containing user settings."""

    settings: UserSettings
    message: str
