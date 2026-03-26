"""
Input sanitization utilities for security.

Prevents XSS and other injection attacks by cleaning user input.
"""

import html
import re
from typing import Optional

# Pre-compiled regex patterns for performance
_RE_HTML_COMMENT = re.compile(r"<!--[^-]{0,10000}(?:-(?!->)[^-]{0,10000})*-->")
_RE_HTML_TAG = re.compile(r"<[^>]{0,1000}>")
_RE_HTML_UNCLOSED = re.compile(r"<[^>]{0,1000}$")
_RE_URI_SCHEME = re.compile(r"(?i)(javascript|data|vbscript)\s*:")
_RE_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]")
_RE_MULTI_SPACES = re.compile(r"[ \t]+")
_RE_MULTI_NEWLINES = re.compile(r"\n[ \t]*\n(?:[ \t]*\n)+")
_RE_TITLE_NEWLINES = re.compile(r"[\r\n]+")
_RE_TITLE_WHITESPACE = re.compile(r"\s+")


def sanitize_text(text: Optional[str], max_length: Optional[int] = None) -> str:
    """
    Sanitize text input by removing potentially dangerous characters.

    - Strips HTML/XML tags (including unclosed tags and comments)
    - Escapes remaining HTML entities
    - Removes control characters (except newlines and tabs)
    - Strips javascript: and data: URI schemes
    - Normalizes whitespace
    - Optionally truncates to max_length

    Args:
        text: Input text to sanitize
        max_length: Maximum length (None for no limit)

    Returns:
        Sanitized text string
    """
    if text is None:
        return ""

    # Convert to string if not already
    text = str(text)

    # Truncate to a safe ceiling before ANY regex runs.
    # Without this bound, patterns like <!--.*?--> are polynomial (O(n²)) on
    # inputs that open <!-- but never close -->, allowing ReDoS.
    _REGEX_SAFE_LIMIT = 100_000
    if len(text) > _REGEX_SAFE_LIMIT:
        text = text[:_REGEX_SAFE_LIMIT]

    # Remove HTML comments
    text = _RE_HTML_COMMENT.sub("", text)

    # Remove HTML/XML tags (including unclosed tags at end of input)
    text = _RE_HTML_TAG.sub("", text)
    text = _RE_HTML_UNCLOSED.sub("", text)

    # Remove dangerous URI schemes (javascript:, data:, vbscript:)
    text = _RE_URI_SCHEME.sub("", text)

    # Escape any remaining HTML entities to prevent XSS
    text = html.escape(text, quote=True)

    # Remove control characters except newline, carriage return, and tab
    text = _RE_CONTROL_CHARS.sub("", text)

    # Normalize excessive whitespace (but preserve single newlines)
    text = _RE_MULTI_SPACES.sub(" ", text)
    text = _RE_MULTI_NEWLINES.sub("\n\n", text)

    # Strip leading/trailing whitespace
    text = text.strip()

    # Truncate if needed
    if max_length and len(text) > max_length:
        text = text[:max_length].rstrip()

    return text


def sanitize_title(title: Optional[str], max_length: int = 200) -> str:
    """
    Sanitize a title/heading field.

    More restrictive than general text - removes newlines and limits length.

    Args:
        title: Input title to sanitize
        max_length: Maximum length (default: 200)

    Returns:
        Sanitized title string
    """
    if title is None:
        return ""

    # Use general sanitization first
    title = sanitize_text(title, max_length=None)

    # Remove newlines and carriage returns (titles should be single line)
    title = _RE_TITLE_NEWLINES.sub(" ", title)

    # Collapse multiple spaces
    title = _RE_TITLE_WHITESPACE.sub(" ", title)

    # Truncate if needed
    if len(title) > max_length:
        title = title[:max_length].rstrip()

    return title.strip()
