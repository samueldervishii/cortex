"""
Beta Features Registry

This file defines all available beta features in the system.
Add new beta features here to make them available to users.

Graduated features (no longer beta):
- branching: Conversation Branching (graduated v0.0.28)
- auto_delete: Auto-Delete Old Chats (graduated v0.0.28)
- custom_prompts: Custom System Prompts (graduated v0.0.28)
"""

from enum import Enum
from typing import List
from pydantic import BaseModel


class BetaFeature(str, Enum):
    """Available beta features that users can opt into."""

    DEBATE_MODE = "debate_mode"
    """Debate Mode - Models argue opposing sides of a topic"""

    BLIND_VOTE = "blind_vote"
    """Blind Vote - Responses shown without model names, pick the best"""

    FACT_CHECK = "fact_check"
    """Fact Check Mode - One model answers, the others fact-check it"""

    COUNCIL_MEMORY = "council_memory"
    """Council Memory - Persistent knowledge base shared across sessions"""

    TOURNAMENT = "tournament"
    """Tournament Mode - Bracket-style elimination between models"""

    ELI5_LADDER = "eli5_ladder"
    """ELI5 Ladder - Same question at multiple complexity levels"""

    MULTI_LANGUAGE = "multi_language"
    """Multi-Language - Council responds in chosen or varied languages"""

    COUNCIL_ANALYTICS = "council_analytics"
    """Council Analytics - Dashboard showing model performance trends"""


class BetaFeatureInfo(BaseModel):
    """Information about a beta feature."""

    id: str
    name: str
    description: str
    status: str  # "coming_soon", "available", "deprecated"


# Registry of all beta features with metadata
BETA_FEATURES_INFO: List[BetaFeatureInfo] = [
    BetaFeatureInfo(
        id=BetaFeature.DEBATE_MODE,
        name="Debate Mode",
        description="Models are assigned PRO/CON sides and argue a topic in structured rounds, with the Chairman judging the winner",
        status="coming_soon",
    ),
    BetaFeatureInfo(
        id=BetaFeature.BLIND_VOTE,
        name="Blind Vote",
        description="Responses shown without model names — pick the best answer, then reveal which model wrote it",
        status="coming_soon",
    ),
    BetaFeatureInfo(
        id=BetaFeature.FACT_CHECK,
        name="Fact Check Mode",
        description="One model answers, the others fact-check it and flag claims as supported, unsupported, or uncertain",
        status="coming_soon",
    ),
    BetaFeatureInfo(
        id=BetaFeature.COUNCIL_MEMORY,
        name="Council Memory",
        description="A persistent knowledge base shared across sessions that the council references automatically",
        status="coming_soon",
    ),
    BetaFeatureInfo(
        id=BetaFeature.TOURNAMENT,
        name="Tournament Mode",
        description="Bracket-style elimination where models compete head-to-head, with the Chairman picking winners each round",
        status="coming_soon",
    ),
    BetaFeatureInfo(
        id=BetaFeature.ELI5_LADDER,
        name="ELI5 Ladder",
        description="Same question answered at multiple complexity levels, from beginner to expert",
        status="coming_soon",
    ),
    BetaFeatureInfo(
        id=BetaFeature.MULTI_LANGUAGE,
        name="Multi-Language",
        description="Council responds in your chosen language, or each model responds in a different language with translations",
        status="coming_soon",
    ),
    BetaFeatureInfo(
        id=BetaFeature.COUNCIL_ANALYTICS,
        name="Council Analytics",
        description="Dashboard showing model performance trends, agreement patterns, and response time insights over time",
        status="coming_soon",
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
