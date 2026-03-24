from enum import Enum
from typing import List, Optional, Dict, Any, Set

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ModelProvider(str, Enum):
    """Supported LLM providers."""

    ANTHROPIC = "anthropic"
    GROQ = "groq"


class CouncilMode(str, Enum):
    """Council deliberation modes."""

    FORMAL = "formal"  # Traditional: parallel responses → peer reviews → synthesis
    CHAT = "chat"  # Group chat: sequential, conversational responses
    ELI5_LADDER = "eli5_ladder"  # Same question at 3 complexity levels (ELI5 → Expert)


class ModelInfo(BaseModel):
    """Information about a configured LLM model."""

    id: str = Field(..., description="Unique model identifier (e.g., 'openai/gpt-4')")
    name: str = Field(..., description="Human-readable model name")
    provider: ModelProvider = Field(..., description="The provider hosting this model")


class ChatMessage(BaseModel):
    """A single message in group chat mode."""

    model_id: str = Field(..., description="The model's unique identifier")
    model_name: str = Field(..., description="Human-readable name of the model")
    content: str = Field(..., description="The message content")
    reply_to: Optional[str] = Field(
        None, description="Model name this is replying to, if any"
    )
    response_time_ms: Optional[int] = Field(
        None, description="Response time in milliseconds"
    )


def _get_valid_model_ids() -> Set[str]:
    """Get the set of valid model IDs from config. Lazy loaded to avoid circular imports."""
    from config import COUNCIL_MODELS, CHAIRMAN_MODEL

    return {m["id"] for m in COUNCIL_MODELS} | {CHAIRMAN_MODEL["id"]}


class QueryRequest(BaseModel):
    """Request to start a new council session."""

    question: str = Field(
        ...,
        description="The question or prompt to send to all council members",
        min_length=1,
        max_length=10000,
        json_schema_extra={
            "example": "What are the best practices for building scalable APIs?"
        },
    )
    mode: CouncilMode = Field(
        default=CouncilMode.FORMAL,
        description="Council mode: 'formal' for structured deliberation, 'chat' for group conversation",
    )
    selected_models: Optional[List[str]] = Field(
        default=None,
        max_length=20,
        description="List of model IDs to use. If not provided, all available models are used.",
    )
    system_prompt: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Custom instructions for all council members (e.g., 'respond in Spanish', 'you are a senior engineer')",
    )

    @field_validator("selected_models")
    @classmethod
    def validate_model_ids(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        """Validate that all selected model IDs are valid."""
        if v is None or len(v) == 0:
            return v

        valid_ids = _get_valid_model_ids()
        invalid_ids = set(v) - valid_ids

        if invalid_ids:
            raise ValueError(
                f"Invalid model ID(s): {', '.join(sorted(invalid_ids))}. "
                f"Valid models: {', '.join(sorted(valid_ids))}"
            )

        return v


class ContinueRequest(BaseModel):
    """Request to continue an existing session with a follow-up question."""

    question: str = Field(
        ...,
        description="The follow-up question for the next round of deliberation",
        min_length=1,
        max_length=10000,
        json_schema_extra={
            "example": "Can you elaborate on the caching strategies mentioned?"
        },
    )


class ModelResponse(BaseModel):
    """Response from a single council member (LLM)."""

    model_config = ConfigDict(protected_namespaces=())

    model_id: str = Field(..., description="The model's unique identifier")
    model_name: str = Field(..., description="Human-readable name of the model")
    response: str = Field(..., description="The model's response to the question")
    error: Optional[str] = Field(
        None, description="Error message if the model failed to respond"
    )
    response_time_ms: Optional[int] = Field(
        None, description="Response time in milliseconds"
    )


class PeerReview(BaseModel):
    """A peer review where one model evaluates other models' responses."""

    reviewer_model: str = Field(..., description="The model that performed this review")
    rankings: List[Dict[str, Any]] = Field(
        ...,
        description="Ranked list of other models' responses with scores and reasoning",
    )


class ConversationRound(BaseModel):
    """
    A single round of council deliberation.

    In FORMAL mode:
    1. A question posed to the council
    2. Responses from each council member
    3. Peer reviews where models evaluate each other
    4. A final synthesis by the chairman

    In CHAT mode:
    1. A question posed to the council
    2. Sequential chat messages where models respond and reply to each other
    """

    question: str = Field(..., description="The question for this round")
    mode: CouncilMode = Field(
        default=CouncilMode.FORMAL, description="The mode used for this round"
    )
    selected_models: Optional[List[str]] = Field(
        default=None,
        description="List of model IDs to use for this round. If None, all models are used.",
    )
    system_prompt: Optional[str] = Field(
        default=None,
        description="Custom instructions applied to all council members for this round",
    )
    # Formal mode fields
    responses: List[ModelResponse] = Field(
        default=[], description="Responses from all council members (formal mode)"
    )
    peer_reviews: List[PeerReview] = Field(
        default=[], description="Peer reviews from each council member (formal mode)"
    )
    final_synthesis: Optional[str] = Field(
        None, description="The chairman's synthesized final answer (formal mode)"
    )
    # Chat mode fields
    chat_messages: List[ChatMessage] = Field(
        default=[], description="Sequential chat messages (chat mode)"
    )
    # Common fields
    status: str = Field(
        default="pending",
        description="Current status: pending, responses_complete, reviews_complete, synthesized, or chat_complete",
    )
    disagreement_analysis: Optional[List[dict]] = Field(
        default=None,
        description="Analysis of disagreement among council members (formal mode)",
    )


class CouncilSession(BaseModel):
    """
    A council session containing one or more rounds of deliberation.

    Sessions persist across multiple rounds, allowing for follow-up questions
    and continued conversation with context from previous rounds.
    """

    id: str = Field(..., description="Unique session identifier (UUID)")
    version: int = Field(
        default=1,
        description="Version number for optimistic locking (prevents race conditions)",
    )
    title: Optional[str] = Field(
        None, description="Session title (derived from first question)"
    )
    rounds: List[ConversationRound] = Field(
        default=[], description="All conversation rounds in this session"
    )
    is_deleted: bool = Field(
        default=False, description="Whether the session has been soft-deleted"
    )
    deleted_at: Optional[str] = Field(
        None, description="ISO timestamp when session was deleted"
    )
    # Pinning
    is_pinned: bool = Field(
        default=False, description="Whether the session is pinned to top"
    )
    pinned_at: Optional[str] = Field(
        None, description="ISO timestamp when session was pinned"
    )
    # Sharing fields
    is_shared: bool = Field(
        default=False, description="Whether the session is publicly shared"
    )
    share_token: Optional[str] = Field(
        None, description="Unique token for public sharing"
    )
    shared_at: Optional[str] = Field(
        None, description="ISO timestamp when session was shared"
    )
    # Branching fields
    parent_session_id: Optional[str] = Field(
        None, description="Session ID this was branched from"
    )
    branched_from_round: Optional[int] = Field(
        None, description="Round index this was branched from (0-indexed)"
    )
    # Folder organization
    folder_id: Optional[str] = Field(
        None, description="ID of the folder this session belongs to"
    )


class BranchRequest(BaseModel):
    """Request to branch a session at a specific point."""

    from_round_index: Optional[int] = Field(
        None,
        description="Round index to branch from (0-indexed). If None, branches from current state (all rounds)",
    )


class RunAllRequest(BaseModel):
    """Optional request body for the run-all endpoint."""

    target_model: Optional[str] = Field(
        None,
        description="If set, only this model responds (used for @mention targeting in chat mode)",
    )


class SynthesisRequest(BaseModel):
    """Request to synthesize responses for a session."""

    session_id: str = Field(..., description="The session ID to synthesize")


class SessionResponse(BaseModel):
    """Standard response containing session data and a status message."""

    session: CouncilSession = Field(..., description="The full session object")
    message: str = Field(..., description="Status message about the operation")


class SessionSummary(BaseModel):
    """Brief summary of a session for listing purposes."""

    id: str = Field(..., description="Session ID")
    title: Optional[str] = Field(None, description="Session title")
    question: str = Field(..., description="The initial question")
    status: str = Field(..., description="Current session status")
    round_count: int = Field(default=1, description="Number of conversation rounds")
    created_at: Optional[str] = Field(None, description="ISO timestamp of creation")
    is_pinned: bool = Field(default=False, description="Whether the session is pinned")
    folder_id: Optional[str] = Field(
        None, description="ID of the folder this session belongs to"
    )


class SessionUpdateRequest(BaseModel):
    """Request to update session properties."""

    title: Optional[str] = Field(
        None, max_length=200, description="New title for the session"
    )
    is_pinned: Optional[bool] = Field(None, description="Pin or unpin the session")


class SessionListResponse(BaseModel):
    """Response containing a list of session summaries."""

    sessions: List[SessionSummary] = Field(..., description="List of session summaries")
    count: int = Field(..., description="Total number of sessions returned")


class ShareResponse(BaseModel):
    """Response when sharing a session."""

    share_token: str = Field(
        ..., description="Unique token for accessing the shared session"
    )
    share_url: str = Field(..., description="Full URL to access the shared session")
    message: str = Field(..., description="Status message")


class DisagreementAnalysis(BaseModel):
    """Analysis of disagreement among council members for a response."""

    model_id: str = Field(..., description="The model whose response was analyzed")
    model_name: str = Field(..., description="Human-readable model name")
    ranks_received: List[int] = Field(
        default=[], description="All ranks given by reviewers"
    )
    mean_rank: float = Field(default=0.0, description="Average rank")
    disagreement_score: float = Field(
        default=0.0,
        description="Disagreement score from 0 (consensus) to 1 (high disagreement)",
    )
    has_disagreement: bool = Field(
        default=False, description="Whether significant disagreement exists"
    )


class AvailableModel(BaseModel):
    """An available model for council selection."""

    id: str = Field(..., description="Model identifier")
    name: str = Field(..., description="Human-readable model name")
    is_chairman: bool = Field(
        default=False, description="Whether this model is the chairman"
    )


class AvailableModelsResponse(BaseModel):
    """Response containing available models for selection."""

    models: List[AvailableModel] = Field(..., description="List of available models")
    chairman: AvailableModel = Field(..., description="The chairman model")
