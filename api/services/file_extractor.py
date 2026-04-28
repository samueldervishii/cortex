"""Extract text content from uploaded files (PDF, DOCX, TXT)."""

import io
import logging
import zipfile

logger = logging.getLogger("etude.file_extractor")

# Max file size: 10MB
MAX_FILE_SIZE = 10 * 1024 * 1024

# Max extracted text length (characters) to keep prompts reasonable
MAX_TEXT_LENGTH = 50000

# Resource limits to prevent denial-of-service via crafted files.
MAX_PDF_PAGES = 500
MAX_DOCX_UNCOMPRESSED = 50 * 1024 * 1024  # 50 MB uncompressed ceiling
MAX_DOCX_FILES = 500  # max entries inside the DOCX zip

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv"}
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/csv",
}


def validate_file(filename: str, content_type: str, size: int, content: bytes = b"") -> None:
    """Validate file type, size, and content. Raises ValueError on invalid files."""
    import os

    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )
    if content_type and content_type not in ALLOWED_MIME_TYPES:
        raise ValueError(
            f"Unsupported content type '{content_type}'. "
            f"Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
        )
    if size > MAX_FILE_SIZE:
        raise ValueError(f"File too large ({size / 1024 / 1024:.1f}MB). Maximum is 10MB.")

    if content and ext in (".pdf", ".docx"):
        _validate_magic_bytes(content, ext)


def _validate_magic_bytes(content: bytes, ext: str) -> None:
    """Verify file content matches its extension using magic bytes."""
    if ext == ".pdf":
        if not content[:5] == b"%PDF-":
            raise ValueError("File content does not match PDF format")
    elif ext == ".docx":
        # DOCX is a ZIP archive starting with PK\x03\x04
        if not content[:4] == b"PK\x03\x04":
            raise ValueError("File content does not match DOCX format")


def extract_text(filename: str, content: bytes) -> str:
    """Extract text from file content based on extension."""
    import os

    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        return _extract_pdf(content)
    elif ext == ".docx":
        return _extract_docx(content)
    elif ext in (".txt", ".md", ".csv"):
        return _extract_text(content)
    else:
        raise ValueError(f"Unsupported file type: {ext}")


def _extract_pdf(content: bytes) -> str:
    """Extract text from PDF bytes (full text, no per-page breakdown)."""
    full_text, _ = extract_pdf_with_pages(content)
    return full_text


def _validate_docx_zip(content: bytes) -> None:
    """Guard against zip-bombs before handing the file to python-docx."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise ValueError("File is not a valid DOCX archive")

    if len(zf.infolist()) > MAX_DOCX_FILES:
        raise ValueError(
            f"DOCX contains too many internal files ({len(zf.infolist())}). "
            f"Maximum is {MAX_DOCX_FILES}."
        )
    total_uncompressed = sum(info.file_size for info in zf.infolist())
    if total_uncompressed > MAX_DOCX_UNCOMPRESSED:
        raise ValueError(
            f"DOCX uncompressed size ({total_uncompressed / 1024 / 1024:.0f} MB) "
            f"exceeds the {MAX_DOCX_UNCOMPRESSED / 1024 / 1024:.0f} MB limit."
        )


def _extract_docx(content: bytes) -> str:
    """Extract text from DOCX bytes."""
    _validate_docx_zip(content)

    # Disable external entity resolution in lxml (XXE prevention).
    # python-docx uses lxml under the hood; configuring a safe parser
    # ensures crafted DOCX XML cannot trigger external lookups.
    from lxml import etree
    safe_parser = etree.XMLParser(resolve_entities=False, no_network=True)
    etree.set_default_parser(safe_parser)

    from docx import Document

    doc = Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]

    full_text = "\n\n".join(paragraphs)
    if len(full_text) > MAX_TEXT_LENGTH:
        full_text = full_text[:MAX_TEXT_LENGTH] + "\n\n[... content truncated due to length]"

    return full_text


def _extract_text(content: bytes) -> str:
    """Extract text from plain text files."""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH] + "\n\n[... content truncated due to length]"

    return text


# --- Chunking for source-aware answers ---

# Target ~500 words per chunk (roughly 3000 chars). Small enough for precise
# citations, large enough for coherent context.
CHUNK_SIZE = 3000
CHUNK_OVERLAP = 200


def _file_slug(filename: str) -> str:
    """Derive a short, safe slug from a filename for use as a chunk ID prefix.

    Examples: 'Report (Final).pdf' -> 'report-final'
              'data.csv' -> 'data'
    """
    import os
    import re as _re
    stem = os.path.splitext(filename)[0]
    # Keep only alphanumeric and spaces, collapse, lowercase, truncate
    slug = _re.sub(r'[^a-zA-Z0-9]+', '-', stem).strip('-').lower()
    return slug[:30] or "file"


def chunk_text(text: str, filename: str, pages: list[str] | None = None) -> list[dict]:
    """Split extracted text into chunks with stable, file-scoped identifiers.

    Chunk IDs are prefixed with a slug derived from the filename so that
    multiple uploads in the same conversation never collide.

    Args:
        text: The full extracted text.
        filename: Source filename (used in chunk metadata).
        pages: If available, per-page text list (for PDFs). Each entry becomes
               a separate chunk (or multiple if too long).

    Returns:
        List of dicts with keys: id, text, source, page.
    """
    slug = _file_slug(filename)
    chunks = []

    if pages:
        # PDF: one chunk per page (split large pages further)
        for page_num, page_text in enumerate(pages, start=1):
            page_text = page_text.strip()
            if not page_text:
                continue
            if len(page_text) <= CHUNK_SIZE:
                chunks.append({
                    "id": f"{slug}-page-{page_num}",
                    "text": page_text,
                    "source": filename,
                    "page": str(page_num),
                })
            else:
                # Split large page into sub-chunks
                for i, start in enumerate(range(0, len(page_text), CHUNK_SIZE - CHUNK_OVERLAP)):
                    chunk = page_text[start : start + CHUNK_SIZE]
                    if not chunk.strip():
                        continue
                    chunks.append({
                        "id": f"{slug}-page-{page_num}-{i + 1}",
                        "text": chunk,
                        "source": filename,
                        "page": str(page_num),
                    })
    else:
        # Non-PDF: chunk by character count with overlap
        if len(text) <= CHUNK_SIZE:
            chunks.append({
                "id": f"{slug}-chunk-1",
                "text": text,
                "source": filename,
                "page": None,
            })
        else:
            idx = 1
            for start in range(0, len(text), CHUNK_SIZE - CHUNK_OVERLAP):
                chunk = text[start : start + CHUNK_SIZE]
                if not chunk.strip():
                    continue
                chunks.append({
                    "id": f"{slug}-chunk-{idx}",
                    "text": chunk,
                    "source": filename,
                    "page": None,
                })
                idx += 1

    return chunks


def extract_pdf_with_pages(content: bytes) -> tuple[str, list[str]]:
    """Extract full text **and** per-page text from a PDF in a single pass.

    Returns ``(full_text, pages)`` where *pages* is a list of per-page
    strings (used for chunking / citation metadata).
    """
    from PyPDF2 import PdfReader

    reader = PdfReader(io.BytesIO(content))

    if len(reader.pages) > MAX_PDF_PAGES:
        raise ValueError(
            f"PDF has {len(reader.pages)} pages, maximum allowed is {MAX_PDF_PAGES}."
        )

    pages: list[str] = []
    text_parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text()
        page_text = text.strip() if text else ""
        pages.append(page_text)
        if page_text:
            text_parts.append(page_text)

    full_text = "\n\n".join(text_parts)
    if len(full_text) > MAX_TEXT_LENGTH:
        full_text = full_text[:MAX_TEXT_LENGTH] + "\n\n[... content truncated due to length]"

    return full_text, pages


def extract_pdf_pages(content: bytes) -> list[str]:
    """Extract text per page from PDF bytes.

    Thin wrapper around :func:`extract_pdf_with_pages` kept for backward
    compatibility.
    """
    _, pages = extract_pdf_with_pages(content)
    return pages
