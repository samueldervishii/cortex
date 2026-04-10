from typing import List, Optional

from pydantic import BaseModel, Field


class SourceChunk(BaseModel):
    """A chunk of text extracted from a file, with a stable identifier."""

    id: str = Field(..., description="Chunk identifier (e.g. 'chunk-1' or 'page-3')")
    text: str = Field(..., description="Chunk text content")
    source: str = Field("", description="Source filename")
    page: Optional[str] = Field(None, description="Page number if available")


class CitationRef(BaseModel):
    """A citation reference in an assistant message, linking to a source chunk."""

    id: str = Field(..., description="Chunk ID this citation refers to")
    text: str = Field("", description="Excerpt from the source")
    source: str = Field("", description="Source filename")
    page: Optional[str] = Field(None, description="Page number if available")


class FileAttachment(BaseModel):
    """A file attached to a message."""

    filename: str = Field(..., description="Original filename")
    content_type: str = Field(..., description="MIME type")
    size: int = Field(..., description="File size in bytes")
    extracted_text: str = Field("", description="Text extracted from the file")
    data_base64: str = Field("", description="Base64-encoded file content (legacy, prefer file_storage_id)")
    file_storage_id: Optional[str] = Field(None, description="Reference to file_storage collection")
    chunks: List[SourceChunk] = Field(default=[], description="Chunked text with identifiers")


class Message(BaseModel):
    """A single message in a conversation."""

    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message content")
    model_id: Optional[str] = Field(None, description="Model ID for assistant messages")
    model_name: Optional[str] = Field(None, description="Model name for assistant messages")
    response_time_ms: Optional[int] = Field(None, description="Response time in ms")
    file: Optional[FileAttachment] = Field(None, description="Attached file")
    is_artifact: bool = Field(False, description="Whether this is a generated document/artifact")
    citations: List[CitationRef] = Field(default=[], description="Source citations for file-based answers")


class ChatSession(BaseModel):
    """A chat session containing messages."""

    id: str = Field(..., description="Unique session identifier (UUID)")
    user_id: Optional[str] = Field(None, description="Owner user ID")
    version: int = Field(default=1, description="Version for optimistic locking")
    title: Optional[str] = Field(None, description="Session title")
    messages: List[Message] = Field(default=[], description="Conversation messages")
    is_deleted: bool = Field(default=False)
    deleted_at: Optional[str] = Field(None)
    is_pinned: bool = Field(default=False)
    pinned_at: Optional[str] = Field(None)
    is_shared: bool = Field(default=False)
    share_token: Optional[str] = Field(None)
    shared_at: Optional[str] = Field(None)


class QueryRequest(BaseModel):
    """Request to send a message."""

    question: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="The message to send",
    )
    system_prompt: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Custom system instructions",
    )


class ContinueRequest(BaseModel):
    """Request to continue a conversation."""

    question: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="Follow-up message",
    )


class StreamRequest(BaseModel):
    """Optional body for the /stream endpoint.

    All fields are optional so existing clients that POST an empty object
    continue to work unchanged.
    """

    model_id: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Override the chat model for this request",
    )


class SessionResponse(BaseModel):
    """Response containing session data."""

    session: ChatSession
    message: str


class SessionSummary(BaseModel):
    """Brief session summary for listing."""

    id: str
    title: Optional[str] = None
    question: str = ""
    status: str = "completed"
    message_count: int = 0
    created_at: Optional[str] = None
    is_pinned: bool = False


class SessionUpdateRequest(BaseModel):
    """Update session properties."""

    title: Optional[str] = Field(None, max_length=200)
    is_pinned: Optional[bool] = None


class SessionListResponse(BaseModel):
    """List of session summaries."""

    sessions: List[SessionSummary]
    count: int


class Artifact(BaseModel):
    """A generated document/artifact linked to a session message."""

    id: str = Field(..., description="Unique artifact ID")
    session_id: str = Field(..., description="Originating session ID")
    message_index: int = Field(..., description="Index of the assistant message that produced this")
    title: str = Field("", description="Artifact title (extracted from first heading)")
    content: str = Field("", description="Artifact content (markdown)")
    created_at: Optional[str] = Field(None)


class ArtifactListResponse(BaseModel):
    """List of artifacts for a session."""

    artifacts: List[Artifact]
    count: int


class BranchRequest(BaseModel):
    """Request to branch a session from a specific message."""

    message_index: int = Field(..., ge=0, description="Branch after this message index (inclusive)")


class ShareResponse(BaseModel):
    """Response when sharing a session."""

    share_token: str
    share_url: str
    message: str
