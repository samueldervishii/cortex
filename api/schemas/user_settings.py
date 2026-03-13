from typing import Optional, List, Dict
from pydantic import BaseModel, Field, field_validator

from constants.beta_features import get_available_beta_features


class UserSettings(BaseModel):
    """User preferences and settings."""

    user_id: str = Field(
        default="default",
        description="User identifier. Default 'default' for single-user mode.",
    )

    # Data & Privacy
    auto_delete_days: Optional[int] = Field(
        default=None,
        description="Auto-delete sessions older than X days. None = never delete. Options: 30, 60, 90",
    )

    # Advanced - Beta Features
    enabled_beta_features: List[str] = Field(
        default=[], description="List of beta feature IDs that the user has opted into"
    )

    # Feature toggles (graduated from beta)
    branching_enabled: bool = Field(
        default=True,
        description="Enable conversation branching feature",
    )
    custom_prompts_enabled: bool = Field(
        default=True,
        description="Enable custom system prompts and model personas",
    )

    # Model Personas - per-model custom personality/instructions
    model_personas: Dict[str, str] = Field(
        default={},
        description="Map of model_id -> persona text (custom personality for each model)",
    )

    @field_validator("enabled_beta_features")
    @classmethod
    def validate_beta_features(cls, v: List[str]) -> List[str]:
        """Strip graduated/invalid features instead of rejecting them."""
        available = get_available_beta_features()
        return [f for f in v if f in available]

    @field_validator("model_personas")
    @classmethod
    def validate_personas(cls, v: Dict[str, str]) -> Dict[str, str]:
        """Validate persona text length."""
        for model_id, persona in v.items():
            if len(persona) > 500:
                raise ValueError(
                    f"Persona for {model_id} exceeds 500 characters"
                )
        return v


class UserSettingsUpdate(BaseModel):
    """Request to update user settings. All fields are optional."""

    auto_delete_days: Optional[int] = Field(
        None,
        description="Auto-delete sessions older than X days. Options: 30, 60, 90, or null",
    )
    enabled_beta_features: Optional[List[str]] = Field(
        None, description="List of beta feature IDs to enable"
    )
    branching_enabled: Optional[bool] = Field(
        None, description="Enable conversation branching feature"
    )
    custom_prompts_enabled: Optional[bool] = Field(
        None, description="Enable custom system prompts and model personas"
    )
    model_personas: Optional[Dict[str, str]] = Field(
        None, description="Map of model_id -> persona text"
    )

    @field_validator("enabled_beta_features")
    @classmethod
    def validate_beta_features(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        """Strip graduated/invalid features instead of rejecting them."""
        if v is None:
            return v
        available = get_available_beta_features()
        return [f for f in v if f in available]

    @field_validator("model_personas")
    @classmethod
    def validate_personas(cls, v: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
        """Validate persona text length."""
        if v is None:
            return v
        for model_id, persona in v.items():
            if len(persona) > 500:
                raise ValueError(
                    f"Persona for {model_id} exceeds 500 characters"
                )
        return v


class UserSettingsResponse(BaseModel):
    """Response containing user settings."""

    settings: UserSettings = Field(..., description="User settings object")
    message: str = Field(..., description="Status message")
