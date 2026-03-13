import logging
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Request, Query, Body

logger = logging.getLogger("llm-council.sessions")

from core.dependencies import (
    get_session_repository,
    get_settings_repository,
    get_llm_client,
    verify_api_key,
)
from core.rate_limit import check_rate_limit
from core.sanitization import sanitize_title
from db import SessionRepository, SettingsRepository
from schemas import (
    QueryRequest,
    ContinueRequest,
    BranchRequest,
    RunAllRequest,
    SessionResponse,
    CouncilSession,
    ConversationRound,
    SessionListResponse,
    SessionSummary,
    SessionUpdateRequest,
    ShareResponse,
    CouncilMode,
)
from services import CouncilService
from services.council import analyze_disagreement

router = APIRouter(prefix="/session", tags=["sessions"])


def get_council_service(client=Depends(get_llm_client)) -> CouncilService:
    return CouncilService(client)


@router.get("s", response_model=SessionListResponse)
async def list_sessions(
    limit: int = Query(
        default=50, ge=1, le=500, description="Maximum number of sessions to return"
    ),
    repo: SessionRepository = Depends(get_session_repository),
):
    """
    List All Sessions

    Retrieves a list of all council sessions, ordered by most recent first.
    Returns summary information for each session including title, status, and round count.

    - **limit**: Maximum number of sessions to return (default: 50, max: 500)
    """
    # Sessions are already sorted in database (pinned first, then by created_at desc)
    sessions = await repo.list_all(limit=limit)
    summaries = []
    for s in sessions:
        created_at = s.get("created_at")
        summaries.append(
            SessionSummary(
                id=s["id"],
                title=s.get("title"),
                question=s["question"],
                status=s["status"],
                round_count=s.get("round_count", 1),
                created_at=created_at.isoformat() if created_at else None,
                is_pinned=s.get("is_pinned", False),
                folder_id=s.get("folder_id"),
            )
        )

    return SessionListResponse(sessions=summaries, count=len(summaries))


@router.post("", response_model=SessionResponse)
async def create_session(
    request: QueryRequest,
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Create New Session

    Starts a new council session with your question. This creates a session
    with a pending first round, ready for council deliberation.

    **Mode options:**
    - `formal`: Traditional council with parallel responses, peer reviews, and synthesis
    - `chat`: Group chat style where models respond sequentially and interact naturally

    **Next step**: Call `POST /session/{id}/run-all` to run the full council process.
    """
    session_id = str(uuid.uuid4())

    # Create first round with the specified mode and selected models
    first_round = ConversationRound(
        question=request.question,
        mode=request.mode,
        selected_models=request.selected_models,
        system_prompt=request.system_prompt,
        status="pending",
    )

    # Sanitize and limit title to prevent XSS and ensure clean data
    session = CouncilSession(
        id=session_id,
        title=sanitize_title(request.question, max_length=100),
        rounds=[first_round],
    )

    await repo.create(session)

    mode_msg = "group chat" if request.mode == CouncilMode.CHAT else "formal council"
    return SessionResponse(
        session=session,
        message=f"Session created in {mode_msg} mode. Call /session/{{id}}/run-all to start.",
    )


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str, repo: SessionRepository = Depends(get_session_repository)
):
    """
    Get Session Details

    Retrieves the complete state of a session including all rounds,
    responses, peer reviews, and synthesis results.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionResponse(session=session, message="Session retrieved")


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Delete Session

    Soft-deletes a session. The session data is preserved but marked as deleted
    and will no longer appear in session lists.
    """
    deleted = await repo.soft_delete(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"message": "Session deleted"}


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    request: SessionUpdateRequest,
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Update Session

    Updates session properties like title or pinned status.
    Only provided fields will be updated.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Pin-only update: use direct method to avoid version conflicts
    # (pin toggling can race with council operations that also update the session)
    if request.is_pinned is not None and request.title is None:
        pinned_at = datetime.now(timezone.utc).isoformat() if request.is_pinned else None
        success = await repo.update_pin(session_id, request.is_pinned, pinned_at)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update pin status")
        session.is_pinned = request.is_pinned
        session.pinned_at = pinned_at
        return SessionResponse(session=session, message="Session updated")

    # Update title if provided (sanitize for security)
    if request.title is not None:
        session.title = sanitize_title(request.title, max_length=200)

    # Update pinned status if provided (combined with title update)
    if request.is_pinned is not None:
        session.is_pinned = request.is_pinned
        if request.is_pinned:
            session.pinned_at = datetime.now(timezone.utc).isoformat()
        else:
            session.pinned_at = None

    try:
        await repo.update(session)
    except ValueError as e:
        logger.warning(f"Version conflict updating session {session_id}: {e}")
        raise HTTPException(
            status_code=409,
            detail="Session was modified by another request. Please retry.",
        )

    return SessionResponse(session=session, message="Session updated")


@router.post("/{session_id}/continue", response_model=SessionResponse)
async def continue_session(
    session_id: str,
    request: ContinueRequest,
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Continue Session

    Adds a follow-up question to an existing session, creating a new round.
    The previous round must be fully completed before continuing.

    This allows for multi-turn conversations where the council can build on
    previous context and answers.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check if last round is complete
    if session.rounds:
        last_round = session.rounds[-1]
        # Allow continuing if synthesized (formal) or chat_complete (chat mode)
        if last_round.status not in ["synthesized", "chat_complete"]:
            raise HTTPException(
                status_code=400,
                detail="Previous round must be completed before continuing",
            )

    # Inherit mode, selected models, and system_prompt from the first round
    first_round = session.rounds[0] if session.rounds else None
    session_mode = first_round.mode if first_round else CouncilMode.FORMAL
    session_models = first_round.selected_models if first_round else None
    session_system_prompt = first_round.system_prompt if first_round else None

    # Add new round with same mode, models, and system prompt as session
    new_round = ConversationRound(
        question=request.question,
        mode=session_mode,
        selected_models=session_models,
        system_prompt=session_system_prompt,
        status="pending",
    )
    session.rounds.append(new_round)

    await repo.update(session)

    mode_msg = "group chat" if session_mode == CouncilMode.CHAT else "council responses"
    return SessionResponse(
        session=session,
        message=f"New round added. Call /session/{{id}}/run-all to get {mode_msg}.",
    )


@router.post("/{session_id}/responses", response_model=SessionResponse)
async def get_responses(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    council_service: CouncilService = Depends(get_council_service),
    _auth: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Collect Council Responses

    Queries all council member LLMs in parallel and collects their responses
    to the current round's question. Each model provides its independent answer.

    **Step 1 of 3** in the council deliberation process.

    **Next step**: Call `POST /session/{id}/reviews` for peer reviews.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.rounds:
        raise HTTPException(status_code=400, detail="No rounds in session")

    current_round = session.rounds[-1]
    previous_rounds = session.rounds[:-1] if len(session.rounds) > 1 else None

    if current_round.status != "pending":
        return SessionResponse(
            session=session, message="Responses already collected for this round"
        )

    responses = await council_service.get_council_responses(
        current_round, previous_rounds
    )
    current_round.responses = responses
    current_round.status = "responses_complete"

    await repo.update(session)

    return SessionResponse(
        session=session,
        message="All council responses collected. Call /session/{id}/reviews for peer reviews.",
    )


@router.post("/{session_id}/reviews", response_model=SessionResponse)
async def get_reviews(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    council_service: CouncilService = Depends(get_council_service),
    _auth: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Collect Peer Reviews

    Each council member reviews and ranks the other models' responses.
    This provides multiple perspectives on the quality and accuracy of each answer.

    **Step 2 of 3** in the council deliberation process.
    Requires responses to be collected first.

    **Next step**: Call `POST /session/{id}/synthesize` for the final synthesis.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.rounds:
        raise HTTPException(status_code=400, detail="No rounds in session")

    current_round = session.rounds[-1]
    previous_rounds = session.rounds[:-1] if len(session.rounds) > 1 else None

    if current_round.status == "pending":
        raise HTTPException(status_code=400, detail="Must collect responses first")

    if current_round.status in ["reviews_complete", "synthesized"]:
        return SessionResponse(
            session=session, message="Reviews already collected for this round"
        )

    valid_responses = [r for r in current_round.responses if not r.error]

    if len(valid_responses) < 2:
        current_round.status = "reviews_complete"
        await repo.update(session)
        return SessionResponse(
            session=session, message="Not enough valid responses for peer review"
        )

    reviews = await council_service.get_peer_reviews(current_round, previous_rounds)
    current_round.peer_reviews = reviews
    current_round.status = "reviews_complete"

    # Analyze disagreement
    current_round.disagreement_analysis = analyze_disagreement(
        current_round.responses, current_round.peer_reviews
    )

    await repo.update(session)

    return SessionResponse(
        session=session,
        message="Peer reviews complete. Call /session/{id}/synthesize for final answer.",
    )


@router.post("/{session_id}/synthesize", response_model=SessionResponse)
async def synthesize(
    session_id: str,
    repo: SessionRepository = Depends(get_session_repository),
    council_service: CouncilService = Depends(get_council_service),
    _auth: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Synthesize Final Answer

    The chairman model analyzes all council responses and peer reviews to
    produce a comprehensive, well-reasoned final answer that incorporates
    the best insights from each council member.

    **Step 3 of 3** in the council deliberation process.
    Completes the current round.

    **Next step**: Optionally call `POST /session/{id}/continue` to ask a follow-up question.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.rounds:
        raise HTTPException(status_code=400, detail="No rounds in session")

    current_round = session.rounds[-1]
    previous_rounds = session.rounds[:-1] if len(session.rounds) > 1 else None

    if current_round.status == "synthesized":
        return SessionResponse(
            session=session, message="Already synthesized for this round"
        )

    if current_round.status == "pending":
        raise HTTPException(status_code=400, detail="Must collect responses first")

    try:
        final_response = await council_service.synthesize_response(
            current_round, previous_rounds
        )
        current_round.final_synthesis = final_response
        current_round.status = "synthesized"

        await repo.update(session)

        return SessionResponse(session=session, message="Synthesis complete!")
    except Exception as e:
        logger.error(f"Synthesis failed for session {session_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Synthesis failed. Please try again later.",
        )


@router.post("/{session_id}/run-all", response_model=SessionResponse)
async def run_full_council(
    session_id: str,
    request: RunAllRequest = Body(None),
    repo: SessionRepository = Depends(get_session_repository),
    council_service: CouncilService = Depends(get_council_service),
    _auth: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Run Full Council Process

    Executes the complete council deliberation in one call.

    **In FORMAL mode:**
    1. **Collect Responses** - Query all council members in parallel
    2. **Peer Reviews** - Each model evaluates the others
    3. **Synthesis** - Chairman produces the final answer

    **In CHAT mode:**
    - Models respond sequentially, seeing and replying to each other
    - Creates a natural group conversation (like WhatsApp)
    - If target_model is set, only that specific model responds (like @mentioning in WhatsApp)

    This is the recommended endpoint for most use cases.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.rounds:
        raise HTTPException(status_code=400, detail="No rounds in session")

    current_round = session.rounds[-1]
    previous_rounds = session.rounds[:-1] if len(session.rounds) > 1 else None
    target_model = request.target_model if request else None

    # Check if using chat mode
    if current_round.mode == CouncilMode.CHAT:
        # Chat mode: run group chat (1 turn = each model responds once, then user can continue)
        if current_round.status == "pending" or target_model:
            chat_messages = await council_service.run_group_chat(
                current_round, previous_rounds, num_turns=1,
                target_model=target_model,
            )
            # Append to existing messages if targeting a specific model
            if target_model and current_round.chat_messages:
                current_round.chat_messages.extend(chat_messages)
            else:
                current_round.chat_messages = chat_messages
            current_round.status = "chat_complete"
            await repo.update(session)

        return SessionResponse(session=session, message="Group chat complete!")

    # Formal mode: traditional 3-step process (optimized to single DB write)
    # Step 1: Get responses
    if current_round.status == "pending":
        responses = await council_service.get_council_responses(
            current_round, previous_rounds
        )
        current_round.responses = responses
        current_round.status = "responses_complete"

    # Step 2: Get peer reviews
    if current_round.status == "responses_complete":
        reviews = await council_service.get_peer_reviews(current_round, previous_rounds)
        current_round.peer_reviews = reviews
        current_round.status = "reviews_complete"
        # Analyze disagreement
        current_round.disagreement_analysis = analyze_disagreement(
            current_round.responses, current_round.peer_reviews
        )

    # Step 3: Synthesize
    if current_round.status == "reviews_complete":
        final_response = await council_service.synthesize_response(
            current_round, previous_rounds
        )
        current_round.final_synthesis = final_response
        current_round.status = "synthesized"

    # Single database write at the end instead of 3 separate writes (major performance improvement)
    try:
        await repo.update(session)
    except ValueError as e:
        logger.warning(f"Version conflict for session {session_id}: {e}")
        raise HTTPException(
            status_code=409,
            detail="Session was modified by another request. Please retry.",
        )

    return SessionResponse(session=session, message="Full council process complete!")


@router.post("/{session_id}/share", response_model=ShareResponse)
async def share_session(
    session_id: str,
    request: Request,
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Share Session

    Generates a public share link for a session. Anyone with the link can view
    the session in read-only mode without authentication.

    Returns the share token and full URL for sharing.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Generate new share token if not already shared
    if not session.is_shared or not session.share_token:
        session.share_token = secrets.token_urlsafe(16)
        session.is_shared = True
        session.shared_at = datetime.now(timezone.utc).isoformat()
        await repo.update(session)

    # Build share URL from request
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
    _auth: bool = Depends(verify_api_key),
):
    """
    Revoke Session Sharing

    Removes public access to a shared session. The share link will no longer work.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.is_shared:
        return {"message": "Session was not shared"}

    session.is_shared = False
    session.share_token = None
    session.shared_at = None
    await repo.update(session)

    return {"message": "Session sharing revoked"}


@router.get("/{session_id}/share-info")
async def get_share_info(
    session_id: str,
    request: Request,
    repo: SessionRepository = Depends(get_session_repository),
):
    """
    Get Share Info

    Returns the current sharing status and share URL if the session is shared.
    """
    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.is_shared or not session.share_token:
        return {"is_shared": False, "share_token": None, "share_url": None}

    base_url = str(request.base_url).rstrip("/")
    return {
        "is_shared": True,
        "share_token": session.share_token,
        "share_url": f"{base_url}/shared/{session.share_token}",
        "shared_at": session.shared_at,
    }


@router.post("/{session_id}/branch", response_model=SessionResponse)
async def branch_session(
    session_id: str,
    request: BranchRequest,
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Branch Session

    Creates a new session that is a fork of an existing session at a specific point.
    The new session will contain all rounds up to (and including) the specified round index.

    - **from_round_index**: Round index to branch from (0-indexed). If None, branches from current state (all rounds).

    **Use Cases:**
    - Branch from current state: Explore different paths without losing the original discussion
    - Branch from specific round: Go back and try a different question at a specific point

    Returns the newly created branched session.
    """
    # Get original session
    original_session = await repo.get(session_id)
    if original_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Determine which rounds to copy
    from_round_index = request.from_round_index
    if from_round_index is None:
        # Branch from current state - copy all rounds
        rounds_to_copy = original_session.rounds
        from_round_index = (
            len(original_session.rounds) - 1 if original_session.rounds else None
        )
    else:
        # Validate round index
        if from_round_index < 0 or from_round_index >= len(original_session.rounds):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid round index. Session has {len(original_session.rounds)} rounds (0-{len(original_session.rounds) - 1})",
            )
        # Copy rounds up to and including the specified index
        rounds_to_copy = original_session.rounds[: from_round_index + 1]

    # Create new branched session (sanitize title for security)
    new_session_id = str(uuid.uuid4())
    original_title = original_session.title or "Untitled"
    branched_title = sanitize_title(f"{original_title} (Branch)", max_length=200)

    branched_session = CouncilSession(
        id=new_session_id,
        title=branched_title,
        rounds=rounds_to_copy,
        parent_session_id=session_id,
        branched_from_round=from_round_index,
        is_deleted=False,
        is_pinned=False,
        is_shared=False,
    )

    # Save branched session
    await repo.create(branched_session)

    return SessionResponse(
        session=branched_session,
        message=f"Session branched successfully from round {from_round_index + 1 if from_round_index is not None else 'current state'}",
    )


@router.delete("s/all")
async def delete_all_sessions(
    confirm: bool = False,
    include_pinned: bool = False,
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Clear All History

    Deletes all chat sessions (soft delete).
    By default, pinned sessions are preserved.

    **Warning:** This action cannot be undone!

    - **confirm**: Must be True to proceed (safety check)
    - **include_pinned**: If True, also deletes pinned sessions (default: False)
    """
    if not confirm:
        raise HTTPException(
            status_code=400, detail="Must set confirm=true to delete all sessions"
        )

    deleted_count = await repo.soft_delete_all(include_pinned=include_pinned)

    if include_pinned:
        message = f"All {deleted_count} sessions deleted successfully"
    else:
        message = f"{deleted_count} sessions deleted (pinned sessions preserved)"

    return {"message": message, "deleted_count": deleted_count}


@router.post("s/cleanup")
async def cleanup_old_sessions(
    session_repo: SessionRepository = Depends(get_session_repository),
    settings_repo: SettingsRepository = Depends(get_settings_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Cleanup Old Sessions (Auto-Delete)

    Runs the auto-delete cleanup based on user settings.
    Deletes sessions older than the configured number of days.

    This endpoint is designed to be called:
    - Manually by the user
    - By a cron job or scheduled task
    - On application startup

    **Requirements:**
    - User must have `auto_delete_days` configured (30, 60, or 90)

    Pinned sessions are always preserved.
    Recently-active sessions (updated within the retention period) are also preserved.
    """
    # Get user settings
    user_settings = await settings_repo.get(user_id="default")

    # Check if auto_delete_days is configured
    if user_settings.auto_delete_days is None:
        return {
            "message": "Auto-delete is enabled but no retention period configured",
            "deleted_count": 0,
            "skipped": True,
        }

    # Validate days value
    valid_days = [30, 60, 90]
    if user_settings.auto_delete_days not in valid_days:
        return {
            "message": f"Invalid auto_delete_days value. Must be one of: {valid_days}",
            "deleted_count": 0,
            "skipped": True,
        }

    # Run cleanup (never delete pinned sessions)
    deleted_count = await session_repo.soft_delete_older_than(
        days=user_settings.auto_delete_days, include_pinned=False
    )

    return {
        "message": f"Auto-delete completed. {deleted_count} sessions older than {user_settings.auto_delete_days} days deleted.",
        "deleted_count": deleted_count,
        "retention_days": user_settings.auto_delete_days,
    }


@router.post("/{session_id}/stream")
async def stream_council(
    session_id: str,
    request: RunAllRequest = Body(None),
    repo: SessionRepository = Depends(get_session_repository),
    settings_repo: SettingsRepository = Depends(get_settings_repository),
    council_service: CouncilService = Depends(get_council_service),
    _auth: bool = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Stream Council Process (SSE)

    Same as run-all but streams results via Server-Sent Events with token-level streaming.
    Tokens arrive as they're generated for a real-time typing effect.

    **Events:**
    - `step` — progress update
    - `response_start` / `response_token` / `response_end` — token-level model responses
    - `synthesis_start` / `synthesis_token` / `synthesis_end` — token-level synthesis
    - `chat_message_start` / `chat_message_token` / `chat_message_end` — token-level chat
    - `error_response` — model that failed to respond
    - `done` — stream complete
    """
    from fastapi.responses import StreamingResponse

    session = await repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.rounds:
        raise HTTPException(status_code=400, detail="No rounds in session")

    current_round = session.rounds[-1]
    previous_rounds = session.rounds[:-1] if len(session.rounds) > 1 else None
    target_model = request.target_model if request else None

    # Load model personas from user settings
    user_settings = await settings_repo.get(user_id="default")
    personas = user_settings.model_personas if user_settings.model_personas else {}

    async def event_stream():
        try:
            if current_round.mode == CouncilMode.CHAT:
                async for event in council_service.stream_group_chat(
                    current_round, previous_rounds, target_model=target_model,
                    personas=personas,
                ):
                    yield event
            else:
                async for event in council_service.stream_formal_council(
                    current_round, previous_rounds, personas=personas,
                ):
                    yield event

            # Save session after streaming completes
            await repo.update(session)
        except Exception as e:
            logger.error(f"Stream error for session {session_id}: {e}")
            import json
            yield f"event: error\ndata: {json.dumps({'message': 'An error occurred during processing.'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("s/export")
async def export_sessions(
    format: str = "json",
    include_deleted: bool = False,
    limit: int = Query(
        default=1000, ge=1, le=5000, description="Maximum sessions to export"
    ),
    repo: SessionRepository = Depends(get_session_repository),
    _auth: bool = Depends(verify_api_key),
):
    """
    Export All Data

    Exports chat sessions in the specified format.
    Useful for backing up your data or importing into other tools.

    - **format**: Export format - "json" or "markdown" (default: "json")
    - **include_deleted**: Include soft-deleted sessions (default: False)
    - **limit**: Maximum number of sessions to export (default: 1000, max: 5000)

    Returns the export data with appropriate Content-Disposition header for download.
    """
    from fastapi.responses import Response
    from services.export import format_as_json, format_as_markdown

    # Validate format
    if format not in ["json", "markdown", "md"]:
        raise HTTPException(
            status_code=400, detail="Invalid format. Must be 'json' or 'markdown'"
        )

    # Normalize format
    if format == "md":
        format = "markdown"

    # Get sessions with limit to prevent memory issues
    sessions = await repo.get_all_full(include_deleted=include_deleted, limit=limit)

    # Format based on requested type
    if format == "json":
        content = format_as_json(sessions)
        media_type = "application/json"
        filename = f"llm_council_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    else:  # markdown
        content = format_as_markdown(sessions)
        media_type = "text/markdown"
        filename = f"llm_council_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.md"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
