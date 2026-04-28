import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request, Query, File, UploadFile, Form
from fastapi.responses import StreamingResponse

logger = logging.getLogger("etude.sessions")

from clients import AIClient
from config import CHAT_MODEL, resolve_model
from core.timestamps import utc_iso
from core.dependencies import (
    get_session_repository,
    get_settings_repository,
    get_ai_client,
    get_current_user,
    verify_api_key,
)
from core.rate_limit import check_rate_limit, user_usage
from core.sanitization import sanitize_title, sanitize_text
from db import SessionRepository, SettingsRepository
from schemas import (
    QueryRequest,
    ContinueRequest,
    StreamRequest,
    ChatSession,
    Message,
    SessionResponse,
    SessionListResponse,
    PaginatedSessionsResponse,
    SessionSummary,
    SessionUpdateRequest,
    Artifact,
    ArtifactListResponse,
    BranchRequest,
    EditMessageRequest,
    ShareResponse,
    FeedbackCreate,
    FeedbackResponse,
)
from services.chat import ChatService
from services import usage_service

router = APIRouter(prefix="/session", tags=["sessions"])


def get_chat_service(client: AIClient = Depends(get_ai_client)) -> ChatService:
    return ChatService(client)


def _strip_file_data(session):
    """Strip ``data_base64`` from session messages before sending to client.

    Kept as a defensive belt-and-suspenders pass for code paths where a
    session was loaded WITHOUT the projection (e.g. constructed from a
    cached doc, or returned from a method that didn't apply the
    ``messages.file.data_base64: 0`` projection). For the common path —
    ``repo.get`` / ``get_by_share_token`` / ``get_all_full`` — the blob
    is already absent because the projection drops it server-side, so
    this loop is essentially a no-op there.
    """
    for msg in session.messages:
        if msg.file and msg.file.data_base64:
            msg.file.data_base64 = ""
    return session


def _doc_to_summary(s: dict) -> SessionSummary:
    created_at = s.get("created_at")
    return SessionSummary(
        id=s["id"],
        title=s.get("title"),
        question=s.get("question", ""),
        status=s.get("status", "completed"),
        message_count=s.get("message_count", 0),
        created_at=utc_iso(created_at) if created_at else None,
        is_pinned=s.get("is_pinned", False),
    )


@router.get("s", response_model=PaginatedSessionsResponse)
async def list_sessions(
    limit: int = Query(default=5, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """List sessions with pagination.

    Returns all pinned sessions (on offset=0 only) plus a page of non-pinned
    sessions. The frontend paginates only the non-pinned list.
    """
    import asyncio

    if offset == 0:
        (recent_docs, total), pinned_docs = await asyncio.gather(
            repo.list_recent_page(user_id=user_id, limit=limit, offset=offset),
            repo.list_pinned(user_id=user_id),
        )
        pinned = [_doc_to_summary(s) for s in pinned_docs]
    else:
        recent_docs, total = await repo.list_recent_page(
            user_id=user_id, limit=limit, offset=offset
        )
        pinned = []
    recent = [_doc_to_summary(s) for s in recent_docs]

    return PaginatedSessionsResponse(
        sessions=recent,
        pinned=pinned,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(recent)) < total,
    )


@router.get("s/search", response_model=SessionListResponse)
async def search_sessions(
    q: str = Query(..., min_length=1, max_length=200),
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Search sessions by content."""
    results = await repo.search(query=q, user_id=user_id)
    summaries = []
    for s in results:
        created_at = s.get("created_at")
        summaries.append(
            SessionSummary(
                id=s["id"],
                title=s.get("title"),
                question=s.get("question", ""),
                status="completed",
                message_count=s.get("message_count", 0),
                created_at=utc_iso(created_at) if created_at else None,
                is_pinned=s.get("is_pinned", False),
            )
        )
    return SessionListResponse(sessions=summaries, count=len(summaries))


@router.post("", response_model=SessionResponse)
async def create_session(
    request: QueryRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Create a new chat session with an initial message."""
    session_id = str(uuid.uuid4())

    clean_question = sanitize_text(request.question, max_length=10000)
    user_message = Message(role="user", content=clean_question)

    session = ChatSession(
        id=session_id,
        user_id=user_id,
        title=sanitize_title(clean_question, max_length=100),
        messages=[user_message],
        is_ghost=request.is_ghost,
    )

    await repo.create(session)

    return SessionResponse(
        session=session,
        message="Session created. Call /session/{id}/stream to get a response.",
    )


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Get full session with all messages."""
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(session=_strip_file_data(session), message="Session retrieved")


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Soft-delete a session."""
    deleted = await repo.soft_delete(session_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session deleted"}


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    request: SessionUpdateRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Update session title or pinned status."""
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if request.is_pinned is not None and request.title is None:
        pinned_at = utc_iso() if request.is_pinned else None
        success = await repo.update_pin(session_id, request.is_pinned, pinned_at, user_id=user_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update pin status")
        session.is_pinned = request.is_pinned
        session.pinned_at = pinned_at
        return SessionResponse(session=session, message="Session updated")

    if request.title is not None:
        session.title = sanitize_title(request.title, max_length=200)
    if request.is_pinned is not None:
        session.is_pinned = request.is_pinned
        session.pinned_at = utc_iso() if request.is_pinned else None

    try:
        await repo.update(session)
    except ValueError as e:
        raise HTTPException(status_code=409, detail="Session was modified. Please retry.")

    return SessionResponse(session=session, message="Session updated")


@router.post("/{session_id}/continue", response_model=SessionResponse)
async def continue_session(
    session_id: str,
    request: ContinueRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Add a follow-up message to an existing session."""
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    clean_question = sanitize_text(request.question, max_length=10000)
    user_message = Message(role="user", content=clean_question)

    # Use targeted $push to avoid read-modify-write race with concurrent streams
    saved = await repo.append_message(session_id, user_message.model_dump(), user_id=user_id)
    if not saved:
        raise HTTPException(status_code=404, detail="Session not found or was deleted")
    session.messages.append(user_message)

    return SessionResponse(
        session=session,
        message="Message added. Call /session/{id}/stream to get a response.",
    )


@router.post("/{session_id}/upload-file", response_model=SessionResponse)
async def upload_file_to_session(
    session_id: str,
    file: UploadFile = File(...),
    question: str = Form(""),
    replace_last: str = Form("false"),
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Upload a file (PDF, DOCX, TXT, or image) and add it as context to the conversation."""
    import os
    from services.file_extractor import (
        validate_file, extract_text, chunk_text, is_image_file, IMAGE_EXTENSIONS,
    )
    from services import file_storage
    from core.sanitization import sanitize_filename
    from schemas import FileAttachment, SourceChunk

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Normalize the client-supplied filename once and use it everywhere.
    safe_name = sanitize_filename(file.filename or "upload")
    safe_content_type = file.content_type or "application/octet-stream"

    # Read file in chunks to enforce size limit without trusting Content-Length.
    # 10MB universal cap; image-specific tighter cap is enforced inside
    # ``validate_file`` once we know the extension.
    MAX_FILE_SIZE = 10 * 1024 * 1024
    chunks_buf = []
    bytes_read = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        bytes_read += len(chunk)
        if bytes_read > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large. Maximum size is 10MB.")
        chunks_buf.append(chunk)
    content = b"".join(chunks_buf)

    try:
        validate_file(safe_name, safe_content_type, len(content), content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    import asyncio
    ext = os.path.splitext(safe_name)[1].lower()
    is_image = ext in IMAGE_EXTENSIONS or is_image_file(safe_name, safe_content_type)

    try:
        if is_image:
            # Vision uploads: bytes are forwarded to the model as an
            # image content block, so we skip text extraction and
            # chunking entirely.
            extracted_text = ""
            pages = None
        elif ext == ".pdf":
            from services.file_extractor import extract_pdf_with_pages
            extracted_text, pages = await asyncio.to_thread(extract_pdf_with_pages, content)
        else:
            extracted_text = await asyncio.to_thread(extract_text, safe_name, content)
            pages = None
    except Exception:
        logger.exception(f"File extraction failed for {safe_name}")
        raise HTTPException(status_code=400, detail="Could not process this file. Please ensure it is a valid PDF, DOCX, or text file.")

    if is_image:
        chunks = []
    else:
        try:
            chunk_dicts = await asyncio.to_thread(chunk_text, extracted_text, safe_name, pages)
            chunks = [SourceChunk(**c) for c in chunk_dicts]
        except Exception:
            logger.debug(f"Chunking failed for {safe_name}, proceeding without chunks")
            chunks = []

    db = repo.collection.database
    # Backend-agnostic write: switches to S3-compatible object storage
    # automatically when ``S3_BUCKET`` is configured, otherwise stores
    # the blob in Mongo as before. Falls back to Mongo on remote-write
    # failure so a misconfigured bucket can't take uploads down.
    storage_id = await file_storage.store_file(
        db,
        session_id=session_id,
        user_id=user_id,
        content=content,
        filename=safe_name,
        content_type=safe_content_type,
    )

    attachment = FileAttachment(
        filename=safe_name,
        content_type=safe_content_type,
        size=len(content),
        extracted_text=extracted_text,
        data_base64="",
        file_storage_id=storage_id,
        chunks=chunks,
    )

    if is_image:
        default_prompt = f"I've attached an image: {safe_name}. Please describe and analyze it."
    else:
        default_prompt = f"I've uploaded a file: {safe_name}. Please analyze it."
    raw_text = question.strip() if question.strip() else default_prompt
    user_text = sanitize_text(raw_text, max_length=10000)
    user_message = Message(role="user", content=user_text, file=attachment)

    # Use targeted MongoDB operations to avoid read-modify-write races
    if replace_last == "true" and session.messages:
        last_msg = session.messages[-1]
        if last_msg.role == "user" and not last_msg.file:
            saved = await repo.replace_last_message(
                session_id, user_message.model_dump(), expected_count=len(session.messages),
                user_id=user_id,
            )
            if not saved:
                raise HTTPException(status_code=409, detail="Session was modified concurrently. Please retry.")
            session.messages[-1] = user_message
        else:
            saved = await repo.append_message(session_id, user_message.model_dump(), user_id=user_id)
            if not saved:
                raise HTTPException(status_code=404, detail="Session not found or was deleted")
            session.messages.append(user_message)
    else:
        saved = await repo.append_message(session_id, user_message.model_dump(), user_id=user_id)
        if not saved:
            raise HTTPException(status_code=404, detail="Session not found or was deleted")
        session.messages.append(user_message)

    # Auto-register uploaded file as a session source (dedup enforced by unique index).
    # Skip for images — they're handed straight to the vision model and don't have
    # citable text chunks that the source manager can search through.
    if is_image:
        return SessionResponse(
            session=_strip_file_data(session),
            message=f"Image '{file.filename}' uploaded.",
        )
    try:
        from pymongo.errors import DuplicateKeyError
        db = repo.collection.database
        source_doc = {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "kind": "file",
            "title": safe_name,
            "url": None,
            "normalized_url": None,
            "domain": None,
            "filename": safe_name,
            "content_type": safe_content_type,
            "size": len(content),
            "extracted_text": extracted_text,
            "chunks": [c.model_dump() for c in chunks],
            "chunk_count": len(chunks),
            "author": None,
            "publisher": None,
            "published_at": None,
            "created_at": utc_iso(),
        }
        await db["sources"].insert_one(source_doc)
    except DuplicateKeyError:
        logger.debug(f"Source already registered for {safe_name}")
    except Exception:
        logger.debug(f"Failed to register source for {safe_name}")

    return SessionResponse(
        session=_strip_file_data(session),
        message=f"File '{file.filename}' uploaded.",
    )


@router.post("/{session_id}/stream")
async def stream_response(
    session_id: str,
    request: StreamRequest = StreamRequest(),
    repo: SessionRepository = Depends(get_session_repository),
    chat_service: ChatService = Depends(get_chat_service),
    user_id: str = Depends(get_current_user),
    _api_key: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Stream AI response via Server-Sent Events."""
    # Resolve which model to use. Unknown IDs silently fall back to default.
    selected_model = resolve_model(request.model_id)
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.messages:
        raise HTTPException(status_code=400, detail="No messages in session")

    # Per-user usage limits: check/record AFTER validating the session exists.
    # Mongo-backed so 50/day and 3s-cooldown are accurate across all workers.
    db = repo.collection.database
    await user_usage.check_and_record(user_id, db)

    # Per-session streaming lock: only one /stream call at a time per session.
    # Acquired BEFORE the token reservation so a duplicate request doesn't
    # eat the user's quota just to fail later.  Released in the event_stream
    # ``finally`` so even client disconnects free the lock.
    if not await repo.acquire_stream_lock(session_id, user_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "Another response is already streaming for this session. "
                "Please wait for it to finish before sending a new request."
            ),
        )

    # Atomic token reservation: claim RESPONSE_TOKEN_RESERVE tokens *before*
    # the stream starts.  The reservation is released when record_usage runs
    # after the stream finishes, swapping the placeholder for actual counts.
    # This prevents concurrent streams from each seeing "under cap" and
    # collectively exceeding the limit.
    try:
        current_usage, reserved_ok = await usage_service.try_reserve_tokens(
            db, user_id, usage_service.RESPONSE_TOKEN_RESERVE,
        )
    except Exception:
        # If the reservation step itself blows up, hand the lock back so the
        # session isn't bricked until the stale-lock TTL expires.
        await repo.release_stream_lock(session_id, user_id)
        raise

    if not reserved_ok:
        await repo.release_stream_lock(session_id, user_id)
        reset = usage_service.format_reset_time(current_usage["resets_in_seconds"])
        raise HTTPException(
            status_code=429,
            detail=(
                f"You've reached your {usage_service.LIMIT_TOKENS:,} token limit "
                f"for this 5-hour window. Resets in {reset}."
            ),
        )
    remaining_tokens = usage_service.LIMIT_TOKENS - current_usage["total_tokens"]

    # Snapshot "first exchange" state BEFORE streaming, so we can trigger
    # automatic title generation once the first assistant reply is saved.
    # (A fresh session has exactly one message: the user's opening question.)
    is_first_exchange = len(session.messages) == 1
    original_title = session.title or ""

    # Get the last user message
    last_user_msg = None
    for msg in reversed(session.messages):
        if msg.role == "user":
            last_user_msg = msg
            break

    if not last_user_msg:
        raise HTTPException(status_code=400, detail="No user message to respond to")

    # Record where the assistant reply should be inserted.
    # If a concurrent continue/upload appends a new user message while the
    # stream is running, $position ensures the reply lands right after the
    # user message it is responding to, not at the very end.
    reply_position = len(session.messages)

    # Detect if user wants a document/artifact generated
    # Must match a VERB + DOCUMENT TYPE pattern, not just any keyword
    _doc_verbs = ["write", "draft", "compose", "prepare", "generate", "create"]
    _doc_types = [
        "essay", "report", "letter", "document", "thesis", "paper",
        "article", "proposal", "outline", "chapter", "introduction",
        "conclusion", "abstract", "review", "analysis", "assignment",
        "paragraph", "cover letter", "resume", "cv",
    ]
    user_text_lower = last_user_msg.content.lower()
    has_verb = any(v in user_text_lower for v in _doc_verbs)
    has_doc_type = any(d in user_text_lower for d in _doc_types)
    is_artifact = has_verb and has_doc_type

    # Collect ALL file chunks across the entire conversation for citation-aware prompting.
    # This ensures follow-up questions about an earlier upload still get structured citations.
    all_chunks = []
    for msg in session.messages:
        if msg.file and msg.file.chunks:
            all_chunks.extend(msg.file.chunks)
    has_chunks = len(all_chunks) > 0

    # ------------------------------------------------------------------
    # Build messages for the model. Vision (image) attachments need to be
    # forwarded as Anthropic content blocks rather than as text, so we
    # construct rich content lists here when an image is involved and
    # fall back to plain strings otherwise. The chat service merger
    # tolerates either shape per message.
    # ------------------------------------------------------------------
    import base64 as _base64
    from services.file_extractor import (
        is_image_file,
        normalize_image_media_type,
    )
    from services import file_storage

    db = repo.collection.database

    async def _image_block_for(msg) -> Optional[dict]:
        """Build an Anthropic image content block for a message attachment."""
        if not msg.file or not is_image_file(msg.file.filename, msg.file.content_type):
            return None
        data_b64: Optional[str] = None
        if msg.file.file_storage_id:
            raw = await file_storage.load_file_bytes(db, msg.file.file_storage_id)
            if raw:
                data_b64 = _base64.b64encode(raw).decode("ascii")
        if not data_b64 and msg.file.data_base64:
            data_b64 = msg.file.data_base64
        if not data_b64:
            return None
        media_type = normalize_image_media_type(
            msg.file.content_type, msg.file.filename
        )
        return {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data_b64},
        }

    def _text_with_file_context(msg) -> str:
        """Render a message's text with any non-image file context inlined."""
        if not msg.file or not msg.file.extracted_text:
            return msg.content
        if is_image_file(msg.file.filename, msg.file.content_type):
            return msg.content
        if msg.file.chunks:
            chunk_sections = []
            for chunk in msg.file.chunks:
                label = f"[{chunk.id}]"
                if chunk.page:
                    label = f"[{chunk.id}, page {chunk.page}]"
                chunk_sections.append(f"{label}\n{chunk.text}")
            return (
                f"{msg.content}\n\n"
                f"--- Source: {msg.file.filename} ---\n"
                + "\n\n".join(chunk_sections)
            )
        return (
            f"{msg.content}\n\n"
            f"--- Attached File: {msg.file.filename} ---\n"
            f"{msg.file.extracted_text}"
        )

    # Current user turn — possibly with an inline image block.
    last_image_block = await _image_block_for(last_user_msg)
    last_text = _text_with_file_context(last_user_msg)
    if last_image_block is not None:
        question_payload: object = [last_image_block, {"type": "text", "text": last_text}]
    else:
        question_payload = last_text

    # History — same idea, per turn.
    history: list[dict] = []
    for msg in session.messages[:-1]:
        text_part = _text_with_file_context(msg)
        img_block = await _image_block_for(msg) if msg.role == "user" else None
        if img_block is not None:
            content: object = [img_block, {"type": "text", "text": text_part}]
        else:
            content = text_part
        history.append({"role": msg.role, "content": content})

    # Build system prompt — add citation instructions when file chunks are available
    system_prompt = (
        "You are Étude, a helpful AI assistant. "
        "When the user asks you to write, create, or generate a document (essay, thesis, report, letter, etc.), "
        "output the document content directly in markdown. The platform will add download buttons automatically. "
        "For normal questions and conversations, respond naturally and conversationally. "
        "Use markdown code blocks with language tags for code snippets."
    )
    if has_chunks:
        system_prompt += (
            "\n\nThe user has uploaded a file whose content is provided as labeled source chunks. "
            "When your answer draws on specific parts of the file, cite the source chunk by appending "
            "a reference like [source: chunk-id] at the end of the relevant sentence or paragraph. "
            "For example: 'The study found a 15% increase [source: report-page-3].' "
            "Only cite chunks you actually reference. Do not fabricate chunk IDs."
        )

    async def event_stream():
        import asyncio as _asyncio
        import json as _json
        response_parts: list[str] = []
        full_response = ""
        model_id = None
        model_name = None
        response_time_ms = None
        input_tokens = 0
        output_tokens = 0
        cleanup_done = False
        db = repo.collection.database

        if is_artifact:
            yield f"event: artifact_hint\ndata: {_json.dumps({'is_artifact': True})}\n\n"

        # The outer try/finally is what catches client disconnects.  Starlette
        # closes the generator (raising GeneratorExit / CancelledError) when
        # the SSE socket drops; ``except Exception`` will NOT catch those, so
        # without this finally the reserved tokens placed by
        # ``try_reserve_tokens`` above would never be returned to the user's
        # bucket and their quota would silently shrink with every disconnect.
        try:
            try:
                _events_since_cancel_poll = 0
                _cancelled = False
                async for event in chat_service.stream_response(
                    question=question_payload,
                    history=history,
                    system_prompt=system_prompt,
                    remaining_tokens=remaining_tokens,
                    model=selected_model,
                    prior_summary=session.conversation_summary,
                    prior_summary_through=session.summary_through,
                ):
                    # Cooperative cancellation. We poll the session doc every
                    # ~16 events (roughly every few hundred ms of generation —
                    # cheap on the database side, fast enough that the user
                    # perceives the stop button as instant). The cancel flag
                    # is just a timestamp set by ``POST /stop``.
                    _events_since_cancel_poll += 1
                    if _events_since_cancel_poll >= 16:
                        _events_since_cancel_poll = 0
                        try:
                            if await repo.is_stream_cancelled(session_id):
                                _cancelled = True
                                yield 'event: cancelled\ndata: {"reason": "user_stopped"}\n\n'
                                break
                        except Exception:
                            logger.debug("Cancel-poll failed", exc_info=True)

                    if event.startswith("event: done"):
                        try:
                            data_start = event.index("data: ") + 6
                            done_data = _json.loads(event[data_start:].strip())
                            input_tokens = int(done_data.get("input_tokens", 0) or 0)
                            output_tokens = int(done_data.get("output_tokens", 0) or 0)
                        except (ValueError, _json.JSONDecodeError):
                            pass
                        continue

                    # Internal: chat service refreshed the conversation
                    # summary cache. Persist it but don't forward to the
                    # browser — it's a server-side concern.
                    if event.startswith("event: summary_update"):
                        try:
                            data_start = event.index("data: ") + 6
                            payload = _json.loads(event[data_start:].strip())
                            new_summary = payload.get("summary") or ""
                            through_val = int(payload.get("through", 0) or 0)
                            if new_summary and through_val > 0:
                                await repo.update_summary(
                                    session_id=session_id,
                                    user_id=user_id,
                                    summary=new_summary,
                                    through=through_val,
                                )
                        except Exception:
                            logger.debug(
                                "Failed to persist conversation summary update",
                                exc_info=True,
                            )
                        continue

                    yield event

                    if "event: token" in event:
                        try:
                            data_start = event.index("data: ") + 6
                            data = _json.loads(event[data_start:].strip())
                            response_parts.append(data.get("content", ""))
                        except (ValueError, _json.JSONDecodeError):
                            pass
                    elif "message_end" in event:
                        try:
                            data_start = event.index("data: ") + 6
                            data = _json.loads(event[data_start:].strip())
                            model_id = data.get("model_id")
                            response_time_ms = data.get("response_time_ms")
                        except (ValueError, _json.JSONDecodeError):
                            pass
                    elif "message_start" in event:
                        try:
                            data_start = event.index("data: ") + 6
                            data = _json.loads(event[data_start:].strip())
                            model_name = data.get("model_name")
                        except (ValueError, _json.JSONDecodeError):
                            pass

                full_response = "".join(response_parts)

                # Save assistant message to session using targeted $push
                # to avoid overwriting concurrent mutations (pin/rename/delete/share)
                if full_response:
                    parsed_citations = []
                    if has_chunks:
                        import re as _re
                        from schemas import CitationRef
                        chunk_map = {c.id: c for c in all_chunks}
                        cited_ids = _re.findall(r'\[source:\s*([a-zA-Z0-9\-]+)\]', full_response)
                        seen = set()
                        for cid in cited_ids:
                            if cid in seen or cid not in chunk_map:
                                continue
                            seen.add(cid)
                            chunk = chunk_map[cid]
                            parsed_citations.append(CitationRef(
                                id=chunk.id,
                                text=chunk.text[:300],
                                source=chunk.source,
                                page=chunk.page,
                            ))

                    assistant_msg = Message(
                        role="assistant",
                        content=full_response,
                        model_id=model_id,
                        model_name=model_name,
                        response_time_ms=response_time_ms,
                        is_artifact=is_artifact,
                        citations=parsed_citations,
                    )
                    msg_saved = await repo.append_message(session_id, assistant_msg.model_dump(), position=reply_position, user_id=user_id)

                    if msg_saved and is_artifact and full_response.strip():
                        import re as _title_re
                        title_match = _title_re.match(r'^#+ (.+)', full_response)
                        artifact_title = title_match.group(1) if title_match else "Generated Document"
                        artifact_doc = {
                            "id": str(uuid.uuid4()),
                            "session_id": session_id,
                            "message_index": reply_position,
                            "title": artifact_title,
                            "content": full_response,
                            "created_at": utc_iso(),
                        }
                        try:
                            await db["artifacts"].insert_one(artifact_doc)
                        except Exception:
                            logger.debug(f"Failed to save artifact for session {session_id}")

                    # First exchange → ask the model to name the chat. This is
                    # an extra LLM round-trip and used to be awaited inline,
                    # which delayed every first ``done`` event by ~1–2s. We
                    # now run it as a detached background task so the user
                    # sees ``done`` as soon as the answer streams; the title
                    # appears whenever the sidebar next refreshes.
                    #
                    # We capture all the values the closure needs as locals
                    # (no `nonlocal`, no shared mutable state) so concurrent
                    # streams in other sessions can't poison each other's
                    # title generation.
                    if msg_saved and is_first_exchange and full_response.strip():
                        _question_for_title = last_user_msg.content
                        _answer_for_title = full_response
                        _model_for_title = selected_model["id"]
                        _original_title = original_title

                        async def _generate_title_bg():
                            try:
                                new_title = await chat_service.client.generate_session_title(
                                    question=_question_for_title,
                                    answer=_answer_for_title,
                                    model_id=_model_for_title,
                                )
                                if not new_title:
                                    return
                                # Only rename if the title hasn't been manually
                                # changed by the user in the meantime.
                                await db["sessions"].update_one(
                                    {
                                        "id": session_id,
                                        "user_id": user_id,
                                        "title": _original_title,
                                    },
                                    {
                                        "$set": {
                                            "title": new_title,
                                            "updated_at": datetime.now(timezone.utc),
                                        }
                                    },
                                )
                            except Exception:
                                logger.debug(
                                    f"Background title generation failed for session {session_id}",
                                    exc_info=True,
                                )

                        try:
                            _asyncio.create_task(_generate_title_bg())
                        except RuntimeError:
                            logger.debug(
                                f"Could not schedule title generation for session {session_id}; "
                                f"event loop closed."
                            )

            except Exception:
                logger.exception(f"Stream error for session {session_id}")
                yield 'event: error\ndata: {"message": "An internal error has occurred. Please try again."}\n\n'

            # Normal-completion cleanup: record usage (or pure release) and
            # emit the terminating `done` event. We set `cleanup_done` as the
            # flag to the outer ``finally`` that no compensation is needed.
            usage_payload = None
            try:
                if input_tokens or output_tokens or full_response:
                    usage_payload = await usage_service.record_usage(
                        db,
                        user_id,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        release_reserved=usage_service.RESPONSE_TOKEN_RESERVE,
                        is_artifact=is_artifact,
                        has_file=bool(last_user_msg.file),
                    )
                else:
                    # Stream produced no output — release the reservation
                    # without recording real usage or bumping message_count.
                    await usage_service.release_reservation(
                        db, user_id, usage_service.RESPONSE_TOKEN_RESERVE,
                    )
                cleanup_done = True
            except Exception:
                logger.exception("Failed to record usage")

            done_data: dict = {"input_tokens": input_tokens, "output_tokens": output_tokens}
            if usage_payload is not None:
                done_data["usage"] = usage_payload
            yield f"event: done\ndata: {_json.dumps(done_data)}\n\n"
        finally:
            # Compensating cleanup for paths that didn't reach the normal
            # cleanup above (CancelledError / GeneratorExit on client
            # disconnect, plus any exception escaping the inner try).
            # We schedule both the reservation release AND the streaming-
            # lock release as detached tasks: awaiting in finally during a
            # cancellation can itself be cancelled mid-await, but tasks
            # spawned via ``create_task`` survive the cancellation and run
            # to completion on the event loop.
            if not cleanup_done:
                try:
                    _asyncio.create_task(
                        usage_service.release_reservation(
                            db, user_id, usage_service.RESPONSE_TOKEN_RESERVE,
                        )
                    )
                except RuntimeError:
                    # Event loop already closed — nothing we can do; the
                    # bucket TTL (30 days) will eventually clean it up.
                    logger.warning(
                        f"Could not schedule reservation release for user {user_id}; "
                        f"event loop closed."
                    )
            # Always release the per-session streaming lock so a new
            # /stream request can proceed.  Stale-lock TTL (3 minutes) is
            # the safety net if even this fails.
            try:
                _asyncio.create_task(
                    repo.release_stream_lock(session_id, user_id)
                )
            except RuntimeError:
                logger.warning(
                    f"Could not schedule stream lock release for session {session_id}"
                )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{session_id}/artifacts", response_model=ArtifactListResponse)
async def list_artifacts(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """List all artifacts generated in a session."""
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    db = repo.collection.database
    cursor = db["artifacts"].find(
        {"session_id": session_id},
        {"_id": 0},
    ).sort("created_at", 1)

    artifacts = []
    async for doc in cursor:
        artifacts.append(Artifact(**doc))

    return ArtifactListResponse(artifacts=artifacts, count=len(artifacts))


@router.get("/{session_id}/file/{message_index}")
async def download_file(
    session_id: str,
    message_index: int,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Download an attached file from a message."""
    import base64
    import asyncio
    from fastapi.responses import Response
    from core.sanitization import sanitize_filename
    from services import file_storage

    # Need the inline base64 here for legacy messages where the bytes
    # are still embedded in the message itself (no ``file_storage_id``).
    session = await repo.get(session_id, user_id=user_id, with_file_blobs=True)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if message_index < 0 or message_index >= len(session.messages):
        raise HTTPException(status_code=404, detail="Message not found")

    msg = session.messages[message_index]
    if not msg.file:
        raise HTTPException(status_code=404, detail="No file attached to this message")

    db = repo.collection.database

    # Path 1: modern messages reference ``file_storage`` — works for
    # both Mongo-backed and S3-backed blobs because file_storage.load
    # transparently dispatches on the stored ``backend`` field.
    file_bytes: Optional[bytes] = None
    if msg.file.file_storage_id:
        file_bytes = await file_storage.load_file_bytes(db, msg.file.file_storage_id)

    # Path 2: legacy fallback for very old messages that inlined the
    # base64 blob directly into the message document.
    if file_bytes is None and msg.file.data_base64:
        file_bytes = await asyncio.to_thread(base64.b64decode, msg.file.data_base64)

    if not file_bytes:
        raise HTTPException(status_code=404, detail="File data not found")

    safe_filename = sanitize_filename(msg.file.filename)
    return Response(
        content=file_bytes,
        media_type=msg.file.content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.get("/{session_id}/export-docx")
async def export_session_docx(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Export a session as a DOCX document."""
    import asyncio
    from fastapi.responses import Response
    from services.docx_export import session_to_docx

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    docx_bytes = await asyncio.to_thread(session_to_docx, session)
    title_slug = (session.title or "chat")[:30].replace(" ", "-").lower()
    filename = f"etude-{title_slug}.docx"

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/message/{message_index}/export-docx")
async def export_message_docx(
    session_id: str,
    message_index: int,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Export a single message as a DOCX document."""
    import asyncio
    from fastapi.responses import Response
    from services.docx_export import message_to_docx

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if message_index < 0 or message_index >= len(session.messages):
        raise HTTPException(status_code=404, detail="Message not found")

    msg = session.messages[message_index]
    docx_bytes = await asyncio.to_thread(message_to_docx, msg.content, session.title)
    filename = f"etude-document.docx"

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{session_id}/share", response_model=ShareResponse)
async def share_session(
    session_id: str,
    request: Request,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Generate a public share link for a session."""
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.is_shared or not session.share_token:
        session.share_token = secrets.token_urlsafe(32)
        session.is_shared = True
        session.shared_at = utc_iso()
        await repo.update(session)

    base_url = str(request.base_url).rstrip("/")
    share_url = f"{base_url}/shared/{session.share_token}"

    return ShareResponse(
        share_token=session.share_token,
        share_url=share_url,
        message="Session shared successfully",
    )


@router.delete("/{session_id}/share")
async def unshare_session(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Revoke public sharing."""
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    session.is_shared = False
    session.share_token = None
    session.shared_at = None
    await repo.update(session)
    return {"message": "Session sharing revoked"}


@router.post("/{session_id}/branch", response_model=SessionResponse)
async def branch_session(
    session_id: str,
    request: BranchRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Branch a new session from a specific message in an existing session.

    Copies messages[0..message_index] into a new session. The original remains unchanged.
    """
    source = await repo.get(session_id, user_id=user_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if request.message_index >= len(source.messages):
        raise HTTPException(status_code=400, detail="Message index out of range")

    # Copy messages up to and including the selected index (full copy including file data)
    branched_messages = [msg.model_copy() for msg in source.messages[: request.message_index + 1]]

    # Derive title from original
    branch_title = f"{source.title or 'Chat'} (branch)"

    new_session_id = str(uuid.uuid4())
    new_session = ChatSession(
        id=new_session_id,
        user_id=user_id,
        title=sanitize_title(branch_title, max_length=200),
        messages=branched_messages,
    )
    await repo.create(new_session)

    # Copy artifact records for artifact messages included in the branch
    db = repo.collection.database
    source_artifacts = await db["artifacts"].find(
        {"session_id": session_id, "message_index": {"$lte": request.message_index}},
        {"_id": 0},
    ).to_list(None)
    if source_artifacts:
        for art in source_artifacts:
            art["id"] = str(uuid.uuid4())
            art["session_id"] = new_session_id
        await db["artifacts"].insert_many(source_artifacts)

    return SessionResponse(session=_strip_file_data(new_session), message="Session branched successfully")


@router.post("/{session_id}/stop")
async def stop_stream(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Request cancellation of an in-flight stream for this session.

    The endpoint is fire-and-forget: it sets a flag on the session and
    returns immediately. The active SSE generator polls the flag between
    tokens and tears down the upstream connection cleanly, recording
    usage for whatever was already produced.

    Returns 200 ``{"cancelled": true}`` if a stream was running, or
    ``{"cancelled": false}`` if there was nothing to stop (still 200,
    because the desired end state — "no stream running" — is already
    true and the client doesn't need to retry).
    """
    requested = await repo.request_stream_cancel(session_id, user_id)
    return {"cancelled": requested}


@router.patch("/{session_id}/message/{message_index}", response_model=SessionResponse)
async def edit_user_message(
    session_id: str,
    message_index: int,
    body: EditMessageRequest,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Edit a user message in place and discard everything after it.

    The conversation is rewound to (and including) the edited message;
    the caller is then expected to call ``/stream`` to produce a fresh
    assistant reply for the new content. Refuses to edit assistant
    messages — they're a record of what was actually generated and
    rewriting them would silently misrepresent model output.
    """
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if message_index < 0 or message_index >= len(session.messages):
        raise HTTPException(status_code=400, detail="Message index out of range")

    if session.messages[message_index].role != "user":
        raise HTTPException(
            status_code=400,
            detail="Only user messages can be edited.",
        )

    new_content = sanitize_text(body.content, max_length=10000)
    if not new_content:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    success = await repo.edit_user_message_and_truncate(
        session_id=session_id,
        message_index=message_index,
        new_content=new_content,
        user_id=user_id,
    )
    if not success:
        raise HTTPException(
            status_code=409,
            detail="Could not edit message (session changed concurrently or message no longer exists).",
        )

    # Tidy up artifacts that referenced messages we just discarded — they'd
    # be orphaned references in the UI otherwise. Best-effort: a failure
    # here doesn't undo the edit.
    try:
        db = repo.collection.database
        await db["artifacts"].delete_many(
            {"session_id": session_id, "message_index": {"$gt": message_index}}
        )
    except Exception:
        logger.debug(
            f"Failed to clean up artifacts after edit on session {session_id}",
            exc_info=True,
        )

    refreshed = await repo.get(session_id, user_id=user_id)
    if refreshed is None:
        raise HTTPException(status_code=404, detail="Session disappeared")
    return SessionResponse(
        session=_strip_file_data(refreshed),
        message="Message edited. Call /stream to regenerate.",
    )


@router.post("/{session_id}/message/{message_index}/regenerate", response_model=SessionResponse)
async def regenerate_assistant_message(
    session_id: str,
    message_index: int,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Discard an assistant message (and anything after it) so it can be
    regenerated.

    Truncates the session so that the previous user turn becomes the
    last message; the client then calls ``/stream`` to get a fresh
    answer. Refuses if the target index isn't an assistant message.
    """
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if message_index < 0 or message_index >= len(session.messages):
        raise HTTPException(status_code=400, detail="Message index out of range")

    if session.messages[message_index].role != "assistant":
        raise HTTPException(
            status_code=400,
            detail="Only assistant messages can be regenerated.",
        )

    success = await repo.truncate_at(
        session_id=session_id,
        keep_count=message_index,
        user_id=user_id,
    )
    if not success:
        raise HTTPException(
            status_code=409,
            detail="Could not regenerate (session changed concurrently).",
        )

    try:
        db = repo.collection.database
        await db["artifacts"].delete_many(
            {"session_id": session_id, "message_index": {"$gte": message_index}}
        )
    except Exception:
        logger.debug(
            f"Failed to clean up artifacts before regenerate on session {session_id}",
            exc_info=True,
        )

    refreshed = await repo.get(session_id, user_id=user_id)
    if refreshed is None:
        raise HTTPException(status_code=404, detail="Session disappeared")
    return SessionResponse(
        session=_strip_file_data(refreshed),
        message="Ready for regeneration. Call /stream to produce a new reply.",
    )


@router.delete("s/all")
async def delete_all_sessions(
    confirm: bool = False,
    include_pinned: bool = False,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Clear all sessions."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Must set confirm=true")
    deleted_count = await repo.soft_delete_all(include_pinned=include_pinned, user_id=user_id)
    return {"message": f"{deleted_count} sessions deleted", "deleted_count": deleted_count}


@router.post("s/cleanup")
async def cleanup_old_sessions(
    session_repo: SessionRepository = Depends(get_session_repository),
    settings_repo: SettingsRepository = Depends(get_settings_repository),
    user_id: str = Depends(get_current_user),
):
    """Auto-delete old sessions based on user settings."""
    user_settings = await settings_repo.get(user_id=user_id)
    if user_settings.auto_delete_days is None:
        return {"message": "Auto-delete not configured", "deleted_count": 0, "skipped": True}

    valid_days = [30, 60, 90]
    if user_settings.auto_delete_days not in valid_days:
        return {"message": "Invalid auto_delete_days", "deleted_count": 0, "skipped": True}

    deleted_count = await session_repo.purge_older_than(
        days=user_settings.auto_delete_days, include_pinned=False, user_id=user_id
    )
    return {
        "message": f"{deleted_count} sessions older than {user_settings.auto_delete_days} days deleted",
        "deleted_count": deleted_count,
    }


@router.get("s/export")
async def export_sessions(
    format: str = "json",
    include_deleted: bool = False,
    limit: int = Query(default=1000, ge=1, le=5000),
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Export sessions as JSON or Markdown."""
    import asyncio
    from fastapi.responses import Response
    from services.export import format_as_json, format_as_markdown

    if format not in ["json", "markdown", "md"]:
        raise HTTPException(status_code=400, detail="Invalid format")
    if format == "md":
        format = "markdown"

    sessions = await repo.get_all_full(include_deleted=include_deleted, limit=limit, user_id=user_id)

    if format == "json":
        content = await asyncio.to_thread(format_as_json, sessions)
        media_type = "application/json"
        filename = f"chat_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    else:
        content = await asyncio.to_thread(format_as_markdown, sessions)
        media_type = "text/markdown"
        filename = f"chat_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.md"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{session_id}/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    session_id: str,
    body: FeedbackCreate,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Submit feedback (thumbs up/down) on an assistant message."""
    from schemas.feedback import ALLOWED_ISSUE_TYPES

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if body.message_index >= len(session.messages):
        raise HTTPException(status_code=400, detail="Invalid message index")

    if session.messages[body.message_index].role != "assistant":
        raise HTTPException(status_code=400, detail="Can only rate assistant messages")

    if body.issue_type and body.issue_type not in ALLOWED_ISSUE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid issue type")

    clean_comment = sanitize_text(body.comment, max_length=2000) if body.comment else None

    db = repo.collection.database
    await db["feedback"].update_one(
        {
            "session_id": session_id,
            "user_id": user_id,
            "message_index": body.message_index,
        },
        {
            "$set": {
                "rating": body.rating,
                "comment": clean_comment,
                "issue_type": body.issue_type,
                "updated_at": utc_iso(),
            },
            "$setOnInsert": {
                "session_id": session_id,
                "user_id": user_id,
                "message_index": body.message_index,
                "created_at": utc_iso(),
            },
        },
        upsert=True,
    )

    return FeedbackResponse(message="Feedback submitted")
