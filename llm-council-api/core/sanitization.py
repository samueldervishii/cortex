"""
Input sanitization utilities for security.

Prevents XSS and other injection attacks by cleaning user input.
"""

import html
import re
from typing import Optional


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

    # Remove HTML comments
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)

    # Remove HTML/XML tags (including unclosed tags)
    # Limit tag matching to prevent ReDoS with unclosed tags
    text = re.sub(r"<[^>]{0,1000}>", "", text)
    # Catch unclosed tags at end of input
    text = re.sub(r"<[^>]{0,1000}$", "", text)

    # Remove dangerous URI schemes (javascript:, data:, vbscript:)
    text = re.sub(r"(?i)(javascript|data|vbscript)\s*:", "", text)

    # Escape any remaining HTML entities to prevent XSS
    text = html.escape(text, quote=True)

    # Remove control characters except newline, carriage return, and tab
    # This prevents things like null bytes, bell characters, etc.
    text = re.sub(r"[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]", "", text)

    # Normalize excessive whitespace (but preserve single newlines)
    text = re.sub(r"[ \t]+", " ", text)  # Multiple spaces/tabs -> single space
    # Use non-ambiguous pattern: match 3+ consecutive newlines (with optional spaces/tabs between)
    # Avoid \s* between \n as \s includes \n, causing ambiguity
    text = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", text)  # 3+ newlines -> 2 newlines

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
    title = re.sub(r"[\r\n]+", " ", title)

    # Collapse multiple spaces
    title = re.sub(r"\s+", " ", title)

    # Truncate if needed
    if len(title) > max_length:
        title = title[:max_length].rstrip()

    return title.strip()
