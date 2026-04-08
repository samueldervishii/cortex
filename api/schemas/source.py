"""Source schemas — session-scoped research sources (files + URLs)."""

from typing import List, Optional

from pydantic import BaseModel, Field


class Source(BaseModel):
    """A research source attached to a session."""

    id: str = Field(..., description="Unique source ID (UUID)")
    session_id: str = Field(..., description="Parent session ID")
    kind: str = Field(..., description="'file' or 'url'")
    title: str = Field("", description="Source title or filename")
    url: Optional[str] = Field(None, description="Original URL (url sources)")
    domain: Optional[str] = Field(None, description="Domain name (url sources)")
    filename: Optional[str] = Field(None, description="Original filename (file sources)")
    content_type: Optional[str] = Field(None, description="MIME type")
    size: Optional[int] = Field(None, description="Content size in bytes")
    extracted_text: str = Field("", description="Extracted readable text")
    chunks: list = Field(default=[], description="Text chunks for search/citation")
    author: Optional[str] = Field(None, description="Author if available")
    publisher: Optional[str] = Field(None, description="Publisher or site name if available")
    published_at: Optional[str] = Field(None, description="Publication date if available")
    created_at: Optional[str] = Field(None, description="When this source was added")


class SourceSummary(BaseModel):
    """Brief source info for listing (no full text or chunks)."""

    id: str
    kind: str
    title: str
    url: Optional[str] = None
    domain: Optional[str] = None
    filename: Optional[str] = None
    content_type: Optional[str] = None
    size: Optional[int] = None
    author: Optional[str] = None
    publisher: Optional[str] = None
    published_at: Optional[str] = None
    created_at: Optional[str] = None
    chunk_count: int = 0


class SourceListResponse(BaseModel):
    sources: List[SourceSummary]
    count: int


class ImportUrlRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2000, description="URL to import")


class ImportUrlResponse(BaseModel):
    source: SourceSummary
    message: str


class QuoteSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Search query")
    max_results: int = Field(default=5, ge=1, le=20)


class QuoteResult(BaseModel):
    text: str = Field(..., description="Matching excerpt")
    source_id: str
    source_title: str
    source_kind: str
    chunk_id: str
    page: Optional[str] = None
    score: float = Field(0.0, description="Relevance score")


class QuoteSearchResponse(BaseModel):
    results: List[QuoteResult]
    query: str
    count: int


class CitationRequest(BaseModel):
    source_id: str = Field(..., description="Source to cite")
    style: str = Field("apa", description="Citation style: apa, mla, chicago")


class CitationResponse(BaseModel):
    citation: str
    style: str
    source_id: str
