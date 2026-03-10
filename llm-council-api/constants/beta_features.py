"""
Beta Features Registry

This file defines all available beta features in the system.
Add new beta features here to make them available to users.
"""

from enum import Enum
from typing import List
from pydantic import BaseModel


class BetaFeature(str, Enum):
    """Available beta features that users can opt into."""

    BRANCHING = "branching"
    """Conversation Branching - Fork conversations to explore different paths"""

    CUSTOM_PROMPTS = "custom_prompts"
    """Custom System Prompts - Define personality for each model"""

    AUTO_DELETE = "auto_delete"
    """Auto-Delete - Automatically delete old sessions after a period"""

    # Add new beta features here as they're developed
    # DEBATE_MODE = "debate_mode"
    # MULTI_LANGUAGE = "multi_language"


class BetaFeatureInfo(BaseModel):
    """Information about a beta feature."""

    id: str
    name: str
    description: str
    status: str  # "coming_soon", "available", "deprecated"


# Registry of all beta features with metadata
BETA_FEATURES_INFO: List[BetaFeatureInfo] = [
    BetaFeatureInfo(
        id=BetaFeature.BRANCHING,
        name="Conversation Branching",
        description="Fork the conversation at any round to explore different paths",
        status="available",  # Changed to available for testing
    ),
    BetaFeatureInfo(
        id=BetaFeature.CUSTOM_PROMPTS,
        name="Custom System Prompts",
        description="Define custom instructions and behavior for all council members",
        status="available",
    ),
    BetaFeatureInfo(
        id=BetaFeature.AUTO_DELETE,
        name="Auto-Delete Old Chats",
        description="Automatically delete chat sessions after 30, 60, or 90 days",
        status="available",
    ),
]


def get_available_beta_features() -> List[str]:
    """Get list of all available beta feature IDs."""
    return [feature.value for feature in BetaFeature]


def get_beta_features_info() -> List[BetaFeatureInfo]:
    """Get detailed information about all beta features."""
    return BETA_FEATURES_INFO


def is_valid_beta_feature(feature_id: str) -> bool:
    """Check if a feature ID is valid."""
    return feature_id in get_available_beta_features()
