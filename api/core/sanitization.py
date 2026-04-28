"""
Input sanitization utilities.

Sanitization here is structural (length caps, control-char stripping,
whitespace normalization). XSS defense lives at the rendering layer:
the frontend renders user messages through React (text nodes — no
``dangerouslySetInnerHTML``) and assistant markdown through
``react-markdown`` with ``rehype-sanitize``, both of which neutralize
``<script>`` payloads safely.

Earlier versions of this module also tried to strip HTML tags and HTML-
escape on the way INTO the database. That was actively harmful because:

  * ``html.escape`` mangles every code snippet a user pastes — ``Vec<T>``,
    ``a > b && c < d``, JSX examples — and feeds the corrupted text both
    to Claude (poisoning the conversation) and to DOCX/markdown exports
    (gibberish entities).
  * The ``<[^>]{0,1000}>`` tag stripper also matches in non-HTML text:
    ``if a < b and c > d`` becomes ``if a  d`` because ``< b and c >``
    looks like a tag to the regex.

Both of those have been removed. If you ever need raw-HTML defense for
a brand-new code path that bypasses the React renderer, write a
purpose-built sanitizer there — don't push it back into this function.
"""

import re
from typing import Optional

_RE_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]")
_RE_MULTI_SPACES = re.compile(r"[ \t]+")
_RE_MULTI_NEWLINES = re.compile(r"\n[ \t]*\n(?:[ \t]*\n)+")
_RE_TITLE_NEWLINES = re.compile(r"[\r\n]+")
_RE_TITLE_WHITESPACE = re.compile(r"\s+")


def sanitize_text(text: Optional[str], max_length: Optional[int] = None) -> str:
    """Normalize a free-form text input for storage.

    - Removes ASCII control characters (except newline, CR, tab)
    - Collapses runs of horizontal whitespace
    - Collapses runs of 3+ blank lines to 2 (preserves paragraphs)
    - Strips leading/trailing whitespace
    - Optionally truncates to ``max_length`` characters

    Does NOT alter HTML-significant characters or strip tags — the renderer
    is responsible for that. See module docstring.
    """
    if text is None:
        return ""

    text = str(text)

    text = _RE_CONTROL_CHARS.sub("", text)

    text = _RE_MULTI_SPACES.sub(" ", text)
    text = _RE_MULTI_NEWLINES.sub("\n\n", text)

    text = text.strip()

    if max_length and len(text) > max_length:
        text = text[:max_length].rstrip()

    return text


def sanitize_filename(filename: Optional[str], max_length: int = 100) -> str:
    """Sanitize a filename to prevent path traversal and injection.

    Strips path components, removes dangerous characters, limits length.
    """
    import os

    if not filename:
        return "download"

    # Strip any directory path components (prevent path traversal)
    filename = os.path.basename(filename)

    # Remove any characters that aren't alphanumeric, dot, hyphen, underscore, or space
    filename = re.sub(r'[^\w.\- ]', '_', filename)

    # Collapse multiple underscores/spaces
    filename = re.sub(r'[_ ]{2,}', '_', filename)

    # Prevent hidden files (starting with dot)
    filename = filename.lstrip('.')

    if not filename:
        return "download"

    if len(filename) > max_length:
        name, ext = os.path.splitext(filename)
        filename = name[:max_length - len(ext)] + ext

    return filename


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
