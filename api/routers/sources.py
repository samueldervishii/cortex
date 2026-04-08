"""Research sources router — import URLs, search quotes, generate citations."""

import logging
import math
import re
import uuid
from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Query

from core.dependencies import get_session_repository, get_current_user
from core.rate_limit import check_rate_limit
from db import SessionRepository
from schemas.source import (
    Source,
    SourceSummary,
    SourceListResponse,
    ImportUrlRequest,
    ImportUrlResponse,
    QuoteSearchRequest,
    QuoteResult,
    QuoteSearchResponse,
    CitationRequest,
    CitationResponse,
)

logger = logging.getLogger("cortex.sources")

router = APIRouter(prefix="/session", tags=["sources"])

SOURCES_COLLECTION = "sources"


# ─── Helpers ───


async def _get_sources_collection(repo: SessionRepository):
    return repo.collection.database[SOURCES_COLLECTION]


async def _verify_session(session_id: str, user_id: str, repo: SessionRepository):
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


# ─── List sources ───


@router.get("/{session_id}/sources", response_model=SourceListResponse)
async def list_sources(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """List all sources in a session."""
    await _verify_session(session_id, user_id, repo)

    col = await _get_sources_collection(repo)
    cursor = col.find(
        {"session_id": session_id},
        {"_id": 0, "extracted_text": 0, "chunks": 0},
    ).sort("created_at", 1)

    sources = []
    async for doc in cursor:
        sources.append(SourceSummary(
            id=doc["id"],
            kind=doc["kind"],
            title=doc.get("title", ""),
            url=doc.get("url"),
            domain=doc.get("domain"),
            filename=doc.get("filename"),
            content_type=doc.get("content_type"),
            size=doc.get("size"),
            author=doc.get("author"),
            published_at=doc.get("published_at"),
            created_at=doc.get("created_at"),
            chunk_count=doc.get("chunk_count", 0),
        ))

    return SourceListResponse(sources=sources, count=len(sources))


# ─── Source preview ───


@router.get("/{session_id}/sources/{source_id}/preview")
async def preview_source(
    session_id: str,
    source_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Return source metadata and a text preview (first ~2000 chars)."""
    await _verify_session(session_id, user_id, repo)

    col = await _get_sources_collection(repo)
    doc = await col.find_one(
        {"session_id": session_id, "id": source_id},
        {"_id": 0, "chunks": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Source not found")

    full_text = doc.get("extracted_text", "")
    preview_text = full_text[:2000]
    if len(full_text) > 2000:
        preview_text += "\n\n[... truncated for preview]"

    return {
        "id": doc["id"],
        "kind": doc["kind"],
        "title": doc.get("title", ""),
        "url": doc.get("url"),
        "domain": doc.get("domain"),
        "filename": doc.get("filename"),
        "author": doc.get("author"),
        "published_at": doc.get("published_at"),
        "publisher": doc.get("publisher"),
        "size": doc.get("size"),
        "chunk_count": doc.get("chunk_count", 0),
        "created_at": doc.get("created_at"),
        "text_preview": preview_text,
        "text_length": len(full_text),
    }


# ─── Import URL (with dedup) ───


@router.post("/{session_id}/sources/import-url", response_model=ImportUrlResponse)
async def import_url(
    session_id: str,
    body: ImportUrlRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Import a web page as a research source. Deduplicates by canonical URL."""
    from services.url_extractor import validate_url, fetch_url, extract_content, normalize_url
    from services.file_extractor import chunk_text

    await _verify_session(session_id, user_id, repo)

    try:
        clean_url = validate_url(body.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    col = await _get_sources_collection(repo)

    # Check for duplicate by normalized URL before fetching
    existing = await col.find_one(
        {"session_id": session_id, "kind": "url", "normalized_url": clean_url},
        {"_id": 0, "id": 1, "title": 1, "url": 1, "domain": 1, "size": 1,
         "author": 1, "published_at": 1, "created_at": 1, "chunk_count": 1},
    )
    if existing:
        summary = SourceSummary(
            id=existing["id"],
            kind="url",
            title=existing.get("title", ""),
            url=existing.get("url"),
            domain=existing.get("domain"),
            size=existing.get("size"),
            author=existing.get("author"),
            published_at=existing.get("published_at"),
            created_at=existing.get("created_at"),
            chunk_count=existing.get("chunk_count", 0),
        )
        return ImportUrlResponse(source=summary, message="Source already imported")

    try:
        html, final_url = await fetch_url(clean_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    extracted = extract_content(html, final_url)

    if not extracted["text"] or len(extracted["text"].strip()) < 50:
        raise HTTPException(status_code=400, detail="Could not extract meaningful content from this URL.")

    # Also check dedup by canonical URL (the page might declare a different canonical)
    canonical = extracted.get("canonical_url") or clean_url
    normalized_canonical = normalize_url(canonical)

    existing_canonical = await col.find_one(
        {"session_id": session_id, "kind": "url", "normalized_url": normalized_canonical},
        {"_id": 0, "id": 1, "title": 1, "url": 1, "domain": 1, "size": 1,
         "author": 1, "published_at": 1, "created_at": 1, "chunk_count": 1},
    )
    if existing_canonical:
        summary = SourceSummary(
            id=existing_canonical["id"],
            kind="url",
            title=existing_canonical.get("title", ""),
            url=existing_canonical.get("url"),
            domain=existing_canonical.get("domain"),
            size=existing_canonical.get("size"),
            author=existing_canonical.get("author"),
            published_at=existing_canonical.get("published_at"),
            created_at=existing_canonical.get("created_at"),
            chunk_count=existing_canonical.get("chunk_count", 0),
        )
        return ImportUrlResponse(source=summary, message="Source already imported")

    # Chunk the extracted text
    chunk_dicts = chunk_text(
        text=extracted["text"],
        filename=extracted["domain"],
    )

    now = datetime.now(timezone.utc).isoformat() + "Z"
    source_id = str(uuid.uuid4())

    source_doc = {
        "id": source_id,
        "session_id": session_id,
        "kind": "url",
        "title": extracted["title"],
        "url": final_url,
        "normalized_url": normalized_canonical,
        "domain": extracted["domain"],
        "filename": None,
        "content_type": "text/html",
        "size": len(extracted["text"].encode("utf-8")),
        "extracted_text": extracted["text"],
        "chunks": chunk_dicts,
        "chunk_count": len(chunk_dicts),
        "author": extracted["author"] or None,
        "publisher": extracted.get("publisher") or None,
        "published_at": extracted["published_at"] or None,
        "created_at": now,
    }

    await col.insert_one(source_doc)

    summary = SourceSummary(
        id=source_id,
        kind="url",
        title=extracted["title"],
        url=final_url,
        domain=extracted["domain"],
        size=source_doc["size"],
        author=source_doc["author"],
        published_at=source_doc["published_at"],
        created_at=now,
        chunk_count=len(chunk_dicts),
    )

    return ImportUrlResponse(source=summary, message=f"Imported: {extracted['title']}")


# ─── Quote search (with content-quality filtering) ───

# Phrases that indicate a chunk is boilerplate, not article content.
# Checked with substring match, not start-of-line — catches mid-chunk junk.
_JUNK_PHRASES = [
    # Feedback / survey
    "did you find what you were looking for",
    "was this page helpful",
    "was this helpful",
    "is this page useful",
    "help us improve",
    "what were you hoping",
    "what was your experience",
    "how would you rate",
    "please rate this",
    "give feedback",
    "send feedback",
    "report a problem",
    "thank you for your feedback",
    "thanks for your feedback",
    "rate this page",
    "your feedback",
    "completing our survey",
    "take our survey",
    "how can we improve",
    "please tell us",
    "let us know",
    # Cookie / consent
    "we use cookies",
    "this site uses cookies",
    "cookie policy",
    "accept cookies",
    "cookie settings",
    "by continuing to use",
    "consent to cookies",
    # Navigation / site chrome
    "skip to main content",
    "skip to content",
    "skip navigation",
    "jump to navigation",
    "back to top",
    "table of contents",
    "on this page",
    "in this section",
    # Subscribe / newsletter
    "subscribe to our newsletter",
    "sign up for our newsletter",
    "join our mailing list",
    "get the latest",
    "enter your email",
    # Related articles noise
    "you may also like",
    "you might also like",
    "recommended for you",
    "related articles",
    "related stories",
    "more from",
    "read next",
    "read more",
    "continue reading",
    "trending now",
    "most popular",
    "editor's picks",
    "don't miss",
    # Social
    "share this article",
    "share on facebook",
    "share on twitter",
    "follow us on",
    # Legal boilerplate
    "all rights reserved",
    "terms of service",
    "terms of use",
    "privacy policy",
    "terms and conditions",
]

# Compiled for fast "any phrase in text" checking
_JUNK_PHRASES_LOWER = [p.lower() for p in _JUNK_PHRASES]

# Pattern for lines that are purely timestamps/dates for related items
_TIMESTAMP_LINE = re.compile(
    r'^\d+ (seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago$',
    re.IGNORECASE,
)


def _count_junk_phrases(text: str) -> int:
    """Count how many junk phrases appear in text."""
    tl = text.lower()
    return sum(1 for p in _JUNK_PHRASES_LOWER if p in tl)


def _is_junk_chunk(text: str) -> bool:
    """True if chunk is likely boilerplate rather than article content."""
    stripped = text.strip()

    # Too short to be meaningful
    if len(stripped) < 40:
        return True

    lines = [l.strip() for l in stripped.split("\n") if l.strip()]
    if not lines:
        return True

    # Navigation-like: many very short lines
    avg_line_len = sum(len(l) for l in lines) / len(lines)
    if avg_line_len < 15 and len(lines) > 3:
        return True

    # High ratio of timestamp-like lines (related article blocks)
    ts_lines = sum(1 for l in lines if _TIMESTAMP_LINE.match(l))
    if ts_lines > 0 and ts_lines >= len(lines) * 0.3:
        return True

    # Multiple junk phrases in a single chunk = almost certainly noise
    junk_count = _count_junk_phrases(stripped)
    if junk_count >= 2:
        return True

    # Single junk phrase in a very short chunk
    if junk_count >= 1 and len(stripped) < 200:
        return True

    return False


def _chunk_quality_penalty(text: str) -> float:
    """Return a penalty (0.0 to 0.5) for low-quality chunk content.

    Applied as a subtraction from the relevance score.
    """
    penalty = 0.0
    tl = text.lower()

    # Penalty for any junk phrases present (even if chunk wasn't fully rejected)
    junk_count = _count_junk_phrases(text)
    if junk_count > 0:
        penalty += 0.15 * junk_count

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if lines:
        avg_len = sum(len(l) for l in lines) / len(lines)
        # Short average line length suggests list/nav rather than prose
        if avg_len < 25:
            penalty += 0.1

    # Penalty for URL-heavy content (link dumps)
    url_count = len(re.findall(r'https?://', tl))
    if url_count > 3:
        penalty += 0.1

    return min(0.5, penalty)


def _score_chunk(query_terms: list[str], text: str) -> float:
    """Score a chunk against query terms using TF-weighted overlap.

    Returns 0.0–1.0. Higher is better.
    """
    text_lower = text.lower()
    words = re.findall(r'[a-z]+', text_lower)
    word_counts = Counter(words)
    total_words = max(len(words), 1)

    if not query_terms:
        return 0.0

    hits = sum(1 for t in query_terms if t in text_lower)
    if hits == 0:
        return 0.0

    coverage = hits / len(query_terms)

    term_freq = sum(word_counts.get(t, 0) for t in query_terms)
    density = min(1.0, term_freq / (total_words * 0.15))

    phrase_bonus = 0.0
    query_phrase = " ".join(query_terms)
    if query_phrase in text_lower:
        phrase_bonus = 0.35

    bigram_bonus = 0.0
    if len(query_terms) >= 2:
        bigram_hits = 0
        for i in range(len(query_terms) - 1):
            bigram = f"{query_terms[i]} {query_terms[i+1]}"
            if bigram in text_lower:
                bigram_hits += 1
        if bigram_hits > 0:
            bigram_bonus = 0.15 * (bigram_hits / (len(query_terms) - 1))

    length_bonus = min(0.1, len(text.strip()) / 5000)

    raw_score = (coverage * 0.5) + (density * 0.25) + phrase_bonus + bigram_bonus + length_bonus

    # Apply quality penalty
    penalty = _chunk_quality_penalty(text)
    score = max(0.0, raw_score - penalty)

    return round(min(1.0, score), 4)


@router.post("/{session_id}/sources/quote-search", response_model=QuoteSearchResponse)
async def search_quotes(
    session_id: str,
    body: QuoteSearchRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Search across all session sources for matching passages."""
    await _verify_session(session_id, user_id, repo)

    col = await _get_sources_collection(repo)
    cursor = col.find(
        {"session_id": session_id},
        {"_id": 0, "id": 1, "title": 1, "kind": 1, "chunks": 1},
    )

    query_terms = [t.lower() for t in re.findall(r'[a-zA-Z]{2,}', body.query)]
    if not query_terms:
        return QuoteSearchResponse(results=[], query=body.query, count=0)

    scored: list[tuple[float, QuoteResult]] = []

    async for doc in cursor:
        for chunk in doc.get("chunks", []):
            chunk_text = chunk.get("text", "")

            # Filter junk chunks before scoring
            if _is_junk_chunk(chunk_text):
                continue

            score = _score_chunk(query_terms, chunk_text)
            if score < 0.2:
                continue

            excerpt = _extract_excerpt(chunk_text, query_terms, max_len=350)

            scored.append((score, QuoteResult(
                text=excerpt,
                source_id=doc["id"],
                source_title=doc.get("title", ""),
                source_kind=doc.get("kind", ""),
                chunk_id=chunk.get("id", ""),
                page=chunk.get("page"),
                score=score,
            )))

    scored.sort(key=lambda x: x[0], reverse=True)

    # Deduplicate: avoid returning multiple chunks from the same source
    # unless they are distinctly different
    results = _dedupe_results(scored, body.max_results)

    return QuoteSearchResponse(results=results, query=body.query, count=len(results))


def _dedupe_results(scored: list[tuple[float, QuoteResult]], max_results: int) -> list[QuoteResult]:
    """Select top results with source diversity.

    Allows at most 2 results from the same source unless there aren't
    enough sources to fill the result set.
    """
    results: list[QuoteResult] = []
    source_count: dict[str, int] = {}
    deferred: list[QuoteResult] = []

    for _score, result in scored:
        sid = result.source_id
        count = source_count.get(sid, 0)
        if count < 2:
            results.append(result)
            source_count[sid] = count + 1
        else:
            deferred.append(result)

        if len(results) >= max_results:
            break

    # Fill remaining slots from deferred if needed
    for result in deferred:
        if len(results) >= max_results:
            break
        results.append(result)

    return results


def _extract_excerpt(text: str, terms: list[str], max_len: int = 350) -> str:
    """Extract the best window from text that contains the most query terms."""
    text_lower = text.lower()

    # Find the densest window: slide a window and count term occurrences
    best_start = 0
    best_count = 0

    for t in terms:
        pos = 0
        while True:
            pos = text_lower.find(t, pos)
            if pos == -1:
                break
            # Count terms in window starting near this position
            win_start = max(0, pos - max_len // 4)
            win_end = min(len(text), win_start + max_len)
            window = text_lower[win_start:win_end]
            count = sum(1 for term in terms if term in window)
            if count > best_count:
                best_count = count
                best_start = win_start
            pos += 1

    if best_count == 0:
        best_start = 0

    end = min(len(text), best_start + max_len)
    start = max(0, end - max_len)

    # Try to snap to word boundaries
    if start > 0:
        space = text.rfind(" ", start, start + 30)
        if space > start:
            start = space + 1
    if end < len(text):
        space = text.find(" ", max(end - 30, start), end)
        if space > 0:
            end = space

    excerpt = text[start:end].strip()
    if start > 0:
        excerpt = "..." + excerpt
    if end < len(text):
        excerpt = excerpt + "..."

    return excerpt


# ─── Citation generator (improved) ───


@router.post("/{session_id}/sources/citation", response_model=CitationResponse)
async def generate_citation(
    session_id: str,
    body: CitationRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Generate a formatted citation for a source."""
    await _verify_session(session_id, user_id, repo)

    col = await _get_sources_collection(repo)
    doc = await col.find_one(
        {"session_id": session_id, "id": body.source_id},
        {"_id": 0, "extracted_text": 0, "chunks": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Source not found")

    style = body.style.lower()
    if style not in ("apa", "mla", "chicago"):
        raise HTTPException(status_code=400, detail="Supported styles: apa, mla, chicago")

    citation = _format_citation(doc, style)

    return CitationResponse(citation=citation, style=style, source_id=body.source_id)


def _parse_date(raw: str) -> tuple[str, str, str]:
    """Parse a date string into (year, month_name, day). Returns empty strings for missing parts."""
    if not raw:
        return ("", "", "")

    # ISO 8601: 2024-03-15T...
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', raw)
    if m:
        months = ["", "January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"]
        year = m.group(1)
        month_num = int(m.group(2))
        month_name = months[month_num] if 1 <= month_num <= 12 else ""
        day = str(int(m.group(3)))
        return (year, month_name, day)

    # Just a year
    m = re.match(r'(\d{4})', raw)
    if m:
        return (m.group(1), "", "")

    return ("", "", "")


def _format_citation(doc: dict, style: str) -> str:
    """Format a deterministic citation from source metadata."""
    title = doc.get("title") or doc.get("filename") or "Untitled"
    author = doc.get("author") or ""
    url = doc.get("url") or ""
    domain = doc.get("domain") or ""
    publisher = doc.get("publisher") or ""
    published = doc.get("published_at") or ""
    kind = doc.get("kind", "file")

    year, month, day = _parse_date(published)
    today = datetime.now(timezone.utc)
    accessed = today.strftime("%B %d, %Y")

    # Use publisher as author fallback for institutional sources
    author_or_org = author or publisher

    if kind == "url":
        return _cite_url(style, title, author_or_org, author, publisher, url, domain, year, month, day, accessed)
    else:
        return _cite_file(style, title, author, year)


def _cite_url(style: str, title: str, author_or_org: str, author: str, publisher: str,
              url: str, domain: str, year: str, month: str, day: str, accessed: str) -> str:
    """Format URL citation in APA, MLA, or Chicago style."""
    # Determine the site/publisher name — prefer og:site_name, fall back to domain
    site_name = publisher or _domain_to_publisher(domain)

    if style == "apa":
        # APA 7th: Author. (Year, Month Day). Title. Site Name. URL
        author_part = f"{author_or_org}. " if author_or_org else ""
        if year and month and day:
            date_part = f"({year}, {month} {day}). "
        elif year:
            date_part = f"({year}). "
        else:
            date_part = "(n.d.). "
        title_part = f"*{title}*. "
        site_part = f"{site_name}. " if site_name and site_name != author_or_org else ""
        return f"{author_part}{date_part}{title_part}{site_part}{url}"

    elif style == "mla":
        # MLA 9th: Author. "Title." Site Name, Day Month Year, URL. Accessed Date.
        author_part = f"{author_or_org}. " if author_or_org else ""
        title_part = f'"{title}." '
        site_part = f"*{site_name}*, " if site_name else ""
        if year and month and day:
            date_part = f"{day} {month} {year}, "
        elif year:
            date_part = f"{year}, "
        else:
            date_part = ""
        return f"{author_part}{title_part}{site_part}{date_part}{url}. Accessed {accessed}."

    else:  # chicago
        # Chicago 17th (Notes-Bibliography): Author. "Title." Site Name. Month Day, Year. Accessed Date. URL.
        author_part = f"{author_or_org}. " if author_or_org else ""
        title_part = f'"{title}." '
        site_part = f"{site_name}. " if site_name else ""
        if year and month and day:
            date_part = f"{month} {day}, {year}. "
        elif year:
            date_part = f"{year}. "
        else:
            date_part = ""
        return f"{author_part}{title_part}{site_part}{date_part}Accessed {accessed}. {url}."


def _domain_to_publisher(domain: str) -> str:
    """Convert a domain to a readable publisher name for citations."""
    known = {
        "nasa.gov": "NASA",
        "who.int": "World Health Organization",
        "un.org": "United Nations",
        "unesco.org": "UNESCO",
        "nist.gov": "National Institute of Standards and Technology",
        "nih.gov": "National Institutes of Health",
        "cdc.gov": "Centers for Disease Control and Prevention",
        "epa.gov": "U.S. Environmental Protection Agency",
        "ed.gov": "U.S. Department of Education",
        "bbc.com": "BBC",
        "bbc.co.uk": "BBC",
        "nytimes.com": "The New York Times",
        "theguardian.com": "The Guardian",
        "washingtonpost.com": "The Washington Post",
        "reuters.com": "Reuters",
        "apnews.com": "Associated Press",
        "nature.com": "Nature",
        "science.org": "Science",
        "arxiv.org": "arXiv",
        "wikipedia.org": "Wikipedia",
        "en.wikipedia.org": "Wikipedia",
        "medium.com": "Medium",
        "github.com": "GitHub",
        "stackoverflow.com": "Stack Overflow",
    }

    # Check exact match and suffix match
    d = domain.lower().removeprefix("www.")
    if d in known:
        return known[d]
    # Try suffix match (e.g. "news.bbc.co.uk" → "bbc.co.uk")
    for key, value in known.items():
        if d.endswith("." + key):
            return value

    # Capitalize domain as fallback
    parts = d.split(".")
    if len(parts) >= 2:
        return parts[-2].capitalize() + "." + parts[-1]
    return d.capitalize()


def _cite_file(style: str, title: str, author: str, year: str) -> str:
    """Format file citation."""
    if style == "apa":
        author_part = f"{author}. " if author else ""
        year_part = f"({year}). " if year else ""
        return f"{author_part}{year_part}*{title}*."
    elif style == "mla":
        author_part = f"{author}. " if author else ""
        return f'{author_part}*{title}*.'
    else:  # chicago
        author_part = f"{author}. " if author else ""
        return f'{author_part}*{title}*.'
