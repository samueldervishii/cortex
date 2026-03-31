import logging
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Request, Query, File, UploadFile, Form
from fastapi.responses import StreamingResponse

logger = logging.getLogger("cortex.sessions")

from clients import AIClient
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
    ChatSession,
    Message,
    SessionResponse,
    SessionListResponse,
    SessionSummary,
    SessionUpdateRequest,
    ShareResponse,
)
from services.chat import ChatService

router = APIRouter(prefix="/session", tags=["sessions"])


def get_chat_service(client: AIClient = Depends(get_ai_client)) -> ChatService:
    return ChatService(client)


def _strip_file_data(session):
    """Strip data_base64 from session messages before sending to client."""
    for msg in session.messages:
        if msg.file:
            msg.file.data_base64 = ""
    return session


@router.get("s", response_model=SessionListResponse)
async def list_sessions(
    limit: int = Query(default=50, ge=1, le=500),
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """List all sessions, ordered by pinned first, then most recent."""
    sessions = await repo.list_all(limit=limit, user_id=user_id)
    summaries = []
    for s in sessions:
        created_at = s.get("created_at")
        summaries.append(
            SessionSummary(
                id=s["id"],
                title=s.get("title"),
                question=s.get("question", ""),
                status=s.get("status", "completed"),
                message_count=s.get("message_count", 0),
                created_at=(created_at.isoformat() + "Z") if created_at else None,
                is_pinned=s.get("is_pinned", False),
            )
        )
    return SessionListResponse(sessions=summaries, count=len(summaries))


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
                created_at=(created_at.isoformat() + "Z") if created_at else None,
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
        pinned_at = datetime.now(timezone.utc).isoformat() if request.is_pinned else None
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
        session.pinned_at = datetime.now(timezone.utc).isoformat() if request.is_pinned else None

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
    session.messages.append(user_message)
    await repo.update(session)

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
    """Upload a file (PDF, DOCX, TXT) and add it as context to the conversation."""
    import base64
    from services.file_extractor import validate_file, extract_text
    from schemas import FileAttachment

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    content = await file.read()

    try:
        validate_file(file.filename, file.content_type, len(content), content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        extracted_text = extract_text(file.filename, content)
    except Exception:
        logger.exception(f"File extraction failed for {file.filename}")
        raise HTTPException(status_code=400, detail="Could not process this file. Please ensure it is a valid PDF, DOCX, or text file.")

    attachment = FileAttachment(
        filename=file.filename,
        content_type=file.content_type,
        size=len(content),
        extracted_text=extracted_text,
        data_base64=base64.b64encode(content).decode("ascii"),
    )

    raw_text = question.strip() if question.strip() else f"I've uploaded a file: {file.filename}. Please analyze it."
    user_text = sanitize_text(raw_text, max_length=10000)
    user_message = Message(role="user", content=user_text, file=attachment)

    # If replace_last is true, replace the last user message (used when creating session + uploading file)
    if replace_last == "true" and session.messages:
        last_msg = session.messages[-1]
        if last_msg.role == "user" and not last_msg.file:
            session.messages[-1] = user_message
        else:
            session.messages.append(user_message)
    else:
        session.messages.append(user_message)

    await repo.update(session)

    return SessionResponse(
        session=_strip_file_data(session),
        message=f"File '{file.filename}' uploaded.",
    )


@router.post("/{session_id}/stream")
async def stream_response(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    chat_service: ChatService = Depends(get_chat_service),
    user_id: str = Depends(get_current_user),
    _api_key: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """Stream AI response via Server-Sent Events."""
    # Per-user usage limits: daily cap + cooldown between messages
    user_usage.check(user_id)
    user_usage.record(user_id)

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.messages:
        raise HTTPException(status_code=400, detail="No messages in session")

    # Get the last user message
    last_user_msg = None
    for msg in reversed(session.messages):
        if msg.role == "user":
            last_user_msg = msg
            break

    if not last_user_msg:
        raise HTTPException(status_code=400, detail="No user message to respond to")

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

    # Build the question — include file content if attached
    question_text = last_user_msg.content
    if last_user_msg.file and last_user_msg.file.extracted_text:
        question_text = (
            f"{last_user_msg.content}\n\n"
            f"--- Attached File: {last_user_msg.file.filename} ---\n"
            f"{last_user_msg.file.extracted_text}"
        )

    # Build conversation history (all messages except the last user message)
    history = []
    for msg in session.messages[:-1]:
        msg_content = msg.content
        # Include file text in history too so the model has full context
        if msg.file and msg.file.extracted_text:
            msg_content = f"{msg.content}\n\n--- Attached File: {msg.file.filename} ---\n{msg.file.extracted_text}"
        history.append({"role": msg.role, "content": msg_content})

    system_prompt = (
        "You are Cortex, a helpful AI assistant. "
        "When the user asks you to write, create, or generate a document (essay, thesis, report, letter, etc.), "
        "output the document content directly in markdown. The platform will add download buttons automatically. "
        "For normal questions and conversations, respond naturally and conversationally. "
        "Use markdown code blocks with language tags for code snippets."
    )

    async def event_stream():
        import json as _json
        full_response = ""
        model_id = None
        model_name = None
        response_time_ms = None

        # Tell frontend if this is an artifact response
        if is_artifact:
            yield f"event: artifact_hint\ndata: {_json.dumps({'is_artifact': True})}\n\n"

        try:
            async for event in chat_service.stream_response(
                question=question_text,
                history=history,
                system_prompt=system_prompt,
            ):
                yield event
                # Parse the event to capture the full response for saving
                if "message_end" in event:
                    import json
                    try:
                        data_start = event.index("data: ") + 6
                        data = json.loads(event[data_start:].strip())
                        full_response = data.get("content", "")
                        model_id = data.get("model_id")
                        response_time_ms = data.get("response_time_ms")
                    except (ValueError, json.JSONDecodeError):
                        pass
                elif "message_start" in event:
                    import json
                    try:
                        data_start = event.index("data: ") + 6
                        data = json.loads(event[data_start:].strip())
                        model_name = data.get("model_name")
                    except (ValueError, json.JSONDecodeError):
                        pass

            # Save assistant message to session
            if full_response:
                assistant_msg = Message(
                    role="assistant",
                    content=full_response,
                    model_id=model_id,
                    model_name=model_name,
                    response_time_ms=response_time_ms,
                    is_artifact=is_artifact,
                )
                session.messages.append(assistant_msg)
                await repo.update(session)

        except Exception:
            logger.exception(f"Stream error for session {session_id}")
            yield 'event: error\ndata: {"message": "An internal error has occurred. Please try again."}\n\n'

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{session_id}/file/{message_index}")
async def download_file(
    session_id: str,
    message_index: int,
    repo: SessionRepository = Depends(get_session_repository),
    user_id: str = Depends(get_current_user),
):
    """Download an attached file from a message."""
    import base64
    from fastapi.responses import Response

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if message_index < 0 or message_index >= len(session.messages):
        raise HTTPException(status_code=404, detail="Message not found")

    msg = session.messages[message_index]
    if not msg.file or not msg.file.data_base64:
        raise HTTPException(status_code=404, detail="No file attached to this message")

    from core.sanitization import sanitize_filename
    file_bytes = base64.b64decode(msg.file.data_base64)
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
    from fastapi.responses import Response
    from services.docx_export import session_to_docx

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    docx_bytes = session_to_docx(session)
    title_slug = (session.title or "chat")[:30].replace(" ", "-").lower()
    filename = f"cortex-{title_slug}.docx"

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
    from fastapi.responses import Response
    from services.docx_export import message_to_docx

    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if message_index < 0 or message_index >= len(session.messages):
        raise HTTPException(status_code=404, detail="Message not found")

    msg = session.messages[message_index]
    docx_bytes = message_to_docx(msg.content, session.title)
    filename = f"cortex-document.docx"

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
):
    """Generate a public share link for a session."""
    session = await repo.get(session_id, user_id=user_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.is_shared or not session.share_token:
        session.share_token = secrets.token_urlsafe(32)
        session.is_shared = True
        session.shared_at = datetime.now(timezone.utc).isoformat()
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

    deleted_count = await session_repo.soft_delete_older_than(
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
    from fastapi.responses import Response
    from services.export import format_as_json, format_as_markdown

    if format not in ["json", "markdown", "md"]:
        raise HTTPException(status_code=400, detail="Invalid format")
    if format == "md":
        format = "markdown"

    sessions = await repo.get_all_full(include_deleted=include_deleted, limit=limit, user_id=user_id)

    if format == "json":
        content = format_as_json(sessions)
        media_type = "application/json"
        filename = f"chat_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    else:
        content = format_as_markdown(sessions)
        media_type = "text/markdown"
        filename = f"chat_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.md"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
