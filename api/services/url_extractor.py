"""Extract readable content from web URLs with aggressive boilerplate filtering."""

import logging
import re
from html.parser import HTMLParser
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

import httpx

logger = logging.getLogger("cortex.url_extractor")

MAX_FETCH_SIZE = 2 * 1024 * 1024  # 2MB max HTML
MAX_TEXT_LENGTH = 50000
FETCH_TIMEOUT = 15.0

BLOCKED_DOMAINS = {"localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"}
BLOCKED_SCHEMES = {"file", "ftp", "data", "javascript"}

_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "ref", "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
}


def normalize_url(url: str) -> str:
    """Normalize a URL: strip tracking params, fragments, trailing slashes."""
    parsed = urlparse(url)
    if parsed.query:
        params = parse_qs(parsed.query, keep_blank_values=False)
        cleaned = {k: v for k, v in params.items() if k.lower() not in _TRACKING_PARAMS}
        query = urlencode(cleaned, doseq=True) if cleaned else ""
    else:
        query = ""
    path = parsed.path.rstrip("/") if parsed.path != "/" else "/"
    return urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", query, ""))


def validate_url(url: str) -> str:
    """Validate and normalise a URL. Returns the cleaned URL or raises ValueError."""
    url = url.strip()
    if not url:
        raise ValueError("URL is required")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("Invalid URL format")
    if parsed.scheme.lower() in BLOCKED_SCHEMES:
        raise ValueError("This URL scheme is not supported")
    hostname = parsed.hostname or ""
    if hostname.lower() in BLOCKED_DOMAINS:
        raise ValueError("This URL is not allowed")
    try:
        import ipaddress
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            raise ValueError("This URL is not allowed")
    except ValueError:
        pass

    return normalize_url(url)


async def fetch_url(url: str) -> tuple[str, str]:
    """Fetch a URL and return (html_content, final_url after redirects)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; CortexBot/1.0; +https://cortex-al.vercel.app)",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            max_redirects=5,
            timeout=httpx.Timeout(FETCH_TIMEOUT),
            verify=True,
        ) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                raise ValueError(f"Unsupported content type: {content_type.split(';')[0]}")

            if len(resp.content) > MAX_FETCH_SIZE:
                raise ValueError("Page is too large to process")

            return resp.text, str(resp.url)

    except httpx.TimeoutException:
        raise ValueError("Request timed out. The page took too long to respond.")
    except httpx.HTTPStatusError as e:
        raise ValueError(f"Page returned HTTP {e.response.status_code}")
    except httpx.RequestError as e:
        raise ValueError(f"Could not reach the URL: {type(e).__name__}")


# ─── HTML Content Extraction ───

# Boilerplate class/id patterns — if ANY of these words appear in class or id,
# the entire element tree is skipped.
_BOILERPLATE_WORDS = (
    # Navigation / menus
    "nav", "menu", "menubar", "navbar", "topbar", "masthead",
    "breadcrumb", "breadcrumbs", "skip-link", "skip-nav",
    # Sidebar / aside
    "sidebar", "side-bar", "aside", "rail", "drawer",
    # Footer / bottom
    "footer", "site-footer", "page-footer", "colophon",
    # Header (site-wide, not article)
    "site-header", "global-header", "masthead",
    # Related / recommended content
    "related", "recommended", "more-stories", "more-articles",
    "read-more", "read-next", "also-read", "you-may-like",
    "trending", "popular", "most-read", "top-stories",
    "latest-news", "latest-stories", "news-grid",
    "related-articles", "related-posts", "related-content",
    "suggested", "suggestion", "recommendations",
    "up-next", "whats-next",
    # Comments
    "comment", "comments", "disqus", "discussion",
    # Social / share
    "social", "share", "sharing", "social-share", "share-buttons",
    "social-media", "follow-us",
    # Feedback / survey / forms
    "feedback", "survey", "rating", "rate-this", "was-this-helpful",
    "page-feedback", "content-feedback", "user-feedback",
    "satisfaction", "nps-survey", "foresee",
    # Cookies / consent / banners
    "cookie", "cookies", "consent", "gdpr", "banner", "alert-banner",
    "notification-bar", "announcement",
    # Newsletter / subscribe / signup
    "newsletter", "subscribe", "subscription", "signup", "sign-up",
    "email-signup", "mailing-list", "cta-banner",
    # Ads / promos
    "advertisement", "ad-slot", "ad-container", "ads", "advert",
    "promo", "promotion", "sponsor", "sponsored",
    # Widgets / utility
    "widget", "toolbar", "search-form", "search-box",
    "pagination", "pager", "page-numbers",
    "tag-cloud", "tags", "categories",
    "table-of-contents", "toc",
    # Popups / modals
    "popup", "modal", "overlay", "lightbox", "dialog",
    # Print / accessibility hidden
    "print-only", "screen-reader", "sr-only", "visually-hidden",
)

_BOILERPLATE_RE = re.compile(
    r'(?:' + '|'.join(re.escape(w) for w in _BOILERPLATE_WORDS) + r')',
    re.IGNORECASE,
)

# Content region class/id patterns — elements matching these are preferred
_CONTENT_WORDS = (
    "article", "post", "entry", "content", "body", "main",
    "story", "text", "prose", "single-post",
    "page-content", "post-content", "article-content", "entry-content",
    "article-body", "story-body", "post-body", "field-body",
    "rich-text", "longform", "chapter",
)

_CONTENT_RE = re.compile(
    r'(?:' + '|'.join(re.escape(w) for w in _CONTENT_WORDS) + r')',
    re.IGNORECASE,
)


class _ContentExtractor(HTMLParser):
    """HTML → text extractor that aggressively filters non-article content.

    Strategy:
    1. ALWAYS skip: script, style, noscript, svg, iframe, template, form
    2. Skip by class/id: any element whose class or id contains a boilerplate word
    3. Skip structural: nav, footer, aside, header (when outside article/main)
    4. Track content depth: text inside <article>, <main>, or content-class elements
       goes to _content_blocks; everything else to _fallback_blocks
    5. If _content_blocks has text, discard _fallback_blocks entirely
    6. Post-process: remove noise lines, survey text, timestamps, junk
    """

    ALWAYS_SKIP = {"script", "style", "noscript", "svg", "iframe", "template", "form"}
    STRUCTURAL_SKIP = {"nav", "footer", "aside"}
    BLOCK_TAGS = {
        "p", "div", "section", "article", "main", "h1", "h2", "h3", "h4", "h5", "h6",
        "li", "blockquote", "pre", "td", "th", "figcaption", "dt", "dd", "summary",
    }

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self._boilerplate_depth = 0
        self._content_depth = 0
        self._tag_stack: list[str] = []
        self._bp_tag_stack: list[str] = []  # Track which tags opened boilerplate regions

        self._content_blocks: list[str] = []
        self._fallback_blocks: list[str] = []

        self._title = ""
        self._in_title = False
        self._meta: dict[str, str] = {}
        self._canonical_url = ""

    def _get_attr(self, attrs: list[tuple[str, str | None]], name: str) -> str:
        for k, v in attrs:
            if k.lower() == name and v:
                return v
        return ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        tag = tag.lower()
        self._tag_stack.append(tag)

        if tag in self.ALWAYS_SKIP:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return

        # Meta / link extraction
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = self._get_attr(attrs, "name") or self._get_attr(attrs, "property")
            content = self._get_attr(attrs, "content")
            if name and content:
                self._meta[name.lower()] = content
        elif tag == "link":
            rel = self._get_attr(attrs, "rel")
            href = self._get_attr(attrs, "href")
            if rel == "canonical" and href:
                self._canonical_url = href

        # Already inside a boilerplate region — don't re-check, just stay skipped
        if self._boilerplate_depth:
            return

        # Check class/id/role/aria-label for boilerplate signals
        cls = self._get_attr(attrs, "class")
        elem_id = self._get_attr(attrs, "id")
        role = self._get_attr(attrs, "role")
        aria = self._get_attr(attrs, "aria-label")
        combined = f"{cls} {elem_id} {role} {aria}"

        if _BOILERPLATE_RE.search(combined):
            self._boilerplate_depth += 1
            self._bp_tag_stack.append(tag)
            return

        # Structural skip when outside content regions
        if tag in self.STRUCTURAL_SKIP and self._content_depth == 0:
            self._boilerplate_depth += 1
            self._bp_tag_stack.append(tag)
            return

        # Top-level <header> is site chrome
        if tag == "header" and self._content_depth == 0:
            self._boilerplate_depth += 1
            self._bp_tag_stack.append(tag)
            return

        # Content region detection
        if tag in ("article", "main") or _CONTENT_RE.search(combined):
            self._content_depth += 1

        if tag in self.BLOCK_TAGS:
            self._append_text("\n")

    def handle_endtag(self, tag: str):
        tag = tag.lower()

        if self._tag_stack and self._tag_stack[-1] == tag:
            self._tag_stack.pop()

        if tag in self.ALWAYS_SKIP:
            self._skip_depth = max(0, self._skip_depth - 1)
            return

        if tag == "title":
            self._in_title = False

        # Close boilerplate region when the tag that opened it closes
        if self._boilerplate_depth > 0 and self._bp_tag_stack and self._bp_tag_stack[-1] == tag:
            self._boilerplate_depth -= 1
            self._bp_tag_stack.pop()
            return

        if self._boilerplate_depth:
            return

        if tag in ("article", "main"):
            self._content_depth = max(0, self._content_depth - 1)
        elif tag in ("div", "section") and self._content_depth > 0:
            self._content_depth = max(0, self._content_depth - 1)

        if tag in self.BLOCK_TAGS:
            self._append_text("\n")

    def handle_data(self, data: str):
        if self._skip_depth:
            return
        if self._in_title:
            self._title += data
        if self._boilerplate_depth:
            return

        text = data.strip()
        if not text:
            return
        self._append_text(text + " ")

    def _append_text(self, text: str):
        if self._content_depth > 0:
            self._content_blocks.append(text)
        else:
            self._fallback_blocks.append(text)

    def get_text(self) -> str:
        if self._content_blocks:
            return "".join(self._content_blocks)
        return "".join(self._fallback_blocks)


# ─── Post-processing ───

# Lines that start with these patterns are almost certainly noise
_NOISE_LINE_START = re.compile(
    r'^('
    # Social/sharing
    r'share\b|share on\b|follow us\b|follow\b|like us\b'
    r'|tweet\b|retweet\b|pin it\b|email this\b'
    # Auth/subscribe
    r'|subscribe\b|sign up\b|sign in\b|log in\b|register\b|create account\b'
    # Cookies/consent
    r'|cookie\b|we use cookies\b|accept\b|accept all\b|dismiss\b|got it\b'
    r'|this site uses\b|by continuing\b|consent\b'
    # Feedback/survey
    r'|did you find\b|was this (helpful|useful|page helpful)\b'
    r'|how (would you|did you|can we)\b'
    r'|what were you\b|what was your\b|please (rate|tell us|let us know)\b'
    r'|rate this\b|give feedback\b|send feedback\b|report a problem\b'
    r'|is this page useful\b|help us improve\b'
    r'|thank you for your feedback\b|thanks for your feedback\b'
    # Navigation labels
    r'|skip to\b|jump to\b|go to\b|back to top\b|back to\b'
    r'|table of contents\b|on this page\b|in this (article|section|page)\b'
    r'|menu\b|home\b|search\b|sitemap\b'
    # Dates-as-labels (timestamps for related articles: "3 days ago", "Jan 15, 2024")
    r'|\d+ (seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago\b'
    # Read-more / related
    r'|read more\b|read next\b|continue reading\b|see (more|also|all)\b'
    r'|related (articles?|posts?|stories?|topics?|content)\b'
    r'|recommended\b|you (may|might) (also )?like\b|more (from|on|about|stories)\b'
    r'|trending\b|popular\b|most read\b|top stories\b|latest\b'
    r'|also read\b|don\'t miss\b|editor\'s pick\b|what\'s new\b'
    # Copyright / legal
    r'|copyright\b|all rights reserved\b|terms of\b|privacy policy\b'
    r'|\u00a9\b'  # ©
    r')',
    re.IGNORECASE,
)

# Full-line patterns — if the entire line matches, it's noise
_NOISE_LINE_FULL = re.compile(
    r'^('
    r'yes|no|maybe'
    r'|share|print|email|save|bookmark'
    r'|previous|next|older|newer'
    r'|show more|load more|view all|expand'
    r'|advertisement|sponsored'
    r'|photo:|image:|credit:|source:|getty|shutterstock|unsplash'
    r')$',
    re.IGNORECASE,
)


def _clean_text(raw: str) -> str:
    """Aggressively post-process extracted text to remove residual noise."""
    text = re.sub(r'\n{3,}', '\n\n', raw).strip()

    lines = text.split("\n")
    cleaned: list[str] = []

    for line in lines:
        stripped = line.strip()

        # Empty lines: keep one, collapse multiples
        if not stripped:
            if cleaned and cleaned[-1] != "":
                cleaned.append("")
            continue

        # Very short lines are usually labels/buttons
        if len(stripped) < 5:
            continue

        # Pure punctuation/symbols/bullets
        if re.match(r'^[\s\-_=|•·›»→←▶◀★☆♦◆…]+$', stripped):
            continue

        # Lines that are just a URL
        if re.match(r'^https?://\S+$', stripped):
            continue

        # Noise line starts
        if _NOISE_LINE_START.match(stripped):
            continue

        # Full-line noise
        if _NOISE_LINE_FULL.match(stripped):
            continue

        # Lines that are just numbers or very short dates
        if re.match(r'^[\d\s/\-,.:]+$', stripped) and len(stripped) < 20:
            continue

        cleaned.append(stripped)

    # Strip trailing empty lines
    while cleaned and cleaned[-1] == "":
        cleaned.pop()
    # Strip leading empty lines
    while cleaned and cleaned[0] == "":
        cleaned.pop(0)

    return "\n".join(cleaned)


def extract_content(html: str, url: str) -> dict:
    """Extract readable text and metadata from HTML.

    Returns dict with keys: title, text, author, published_at, domain, url,
    publisher, canonical_url.
    """
    parser = _ContentExtractor()
    try:
        parser.feed(html)
    except Exception:
        logger.debug("HTML parsing error, using partial result")

    raw_text = parser.get_text()
    text = _clean_text(raw_text)

    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH] + "\n\n[... content truncated due to length]"

    parsed = urlparse(url)
    domain = parsed.netloc.removeprefix("www.")

    meta = parser._meta
    title = (
        meta.get("og:title")
        or meta.get("twitter:title")
        or parser._title.strip()
        or domain
    )
    if " | " in title:
        title = title.split(" | ")[0].strip()
    elif " - " in title and len(title.split(" - ")) <= 3:
        parts = title.split(" - ")
        if len(parts[-1]) < 30:
            title = " - ".join(parts[:-1]).strip()

    author = (
        meta.get("author")
        or meta.get("article:author")
        or meta.get("og:article:author")
        or meta.get("citation_author")
        or ""
    )
    if author and (author.startswith("http") or "/" in author):
        author = ""

    published = (
        meta.get("article:published_time")
        or meta.get("og:article:published_time")
        or meta.get("date")
        or meta.get("pubdate")
        or meta.get("citation_publication_date")
        or meta.get("dc.date")
        or ""
    )

    publisher = (
        meta.get("og:site_name")
        or meta.get("application-name")
        or ""
    )

    canonical = parser._canonical_url or url

    return {
        "title": title[:200],
        "text": text,
        "author": author[:200],
        "published_at": published[:100],
        "publisher": publisher[:200],
        "domain": domain,
        "url": url,
        "canonical_url": normalize_url(canonical) if canonical else url,
    }
