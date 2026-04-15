"""
Health check endpoints for Kubernetes/Docker orchestration.

Provides /health (liveness), /ready (readiness), and /status (dashboard) probes.
"""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response, status

from db import get_database
from config import CHAT_MODEL, VERSION, settings
from core.circuit_breaker import get_circuit_breaker_status
from core.dependencies import get_current_user
from services import status_tracker

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """
    Liveness Probe

    Returns 200 if the application is running.
    """
    return {"status": "healthy", "service": "cortex-api", "version": VERSION}


@router.get("/ready")
async def readiness_check(response: Response):
    """
    Readiness Probe

    Returns 200 if the application is ready to serve traffic.
    Checks MongoDB connection and circuit breaker status.
    """
    checks = {"mongodb": "unknown", "circuit_breaker": "unknown"}
    is_ready = True

    # Check MongoDB
    try:
        db = await get_database()
        await asyncio.wait_for(db.command("ping"), timeout=2.0)
        checks["mongodb"] = "healthy"
    except asyncio.TimeoutError:
        checks["mongodb"] = "timeout"
        is_ready = False
    except Exception as e:
        checks["mongodb"] = "unhealthy"
        is_ready = False

    # Check Circuit Breaker
    try:
        breaker_status = get_circuit_breaker_status("anthropic")
        checks["circuit_breaker"] = breaker_status.get("state", "unknown")
        if breaker_status.get("state") == "open":
            is_ready = False
    except Exception as e:
        checks["circuit_breaker"] = "error"

    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if is_ready else "not_ready", "checks": checks}


@router.get("/status")
async def status_check(
    response: Response,
    _user: str = Depends(get_current_user),
):
    """
    Status Dashboard Endpoint (authenticated)

    Returns system status for the frontend status page.
    Requires authentication to prevent infrastructure reconnaissance.
    """
    checks = {}
    is_healthy = True

    # API Server
    checks["api_server"] = {"status": "operational", "detail": "Responding to requests"}

    # MongoDB — only show status, not latency details
    try:
        db = await get_database()
        await asyncio.wait_for(db.command("ping"), timeout=2.0)
        checks["mongodb"] = {"status": "operational", "detail": "Connected"}
    except asyncio.TimeoutError:
        checks["mongodb"] = {"status": "degraded", "detail": "Slow response"}
        is_healthy = False
    except Exception:
        checks["mongodb"] = {"status": "down", "detail": "Unavailable"}
        is_healthy = False

    # AI Service — only show up/down, not internal circuit breaker details
    try:
        breaker = get_circuit_breaker_status("anthropic")
        state = breaker.get("state", "unknown")
        if state == "open":
            checks["ai_service"] = {"status": "degraded", "detail": "Temporarily unavailable"}
            is_healthy = False
        else:
            checks["ai_service"] = {"status": "operational", "detail": "Available"}
    except Exception:
        checks["ai_service"] = {"status": "unknown", "detail": "Unable to check"}

    result = {
        "overall_status": "operational" if is_healthy else "degraded",
        "checks": checks,
        # Minimal model info — no IDs, no provider details
        "providers": {"anthropic": {"configured": True, "models": ["Claude Sonnet 4.6"]}},
        "models": {"chat_model": {"name": "Claude Sonnet 4.6"}},
    }

    if not is_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return result


@router.get("/status/uptime")
async def status_uptime():
    """
    Public uptime history endpoint.

    Intentionally unauthenticated — a status page that requires a login to
    tell users the service is down is useless exactly when they need it
    most. The response contains only service labels, current status, and
    uptime percentages; no secrets, tokens, or user data.
    """
    try:
        db = await get_database()
        return await status_tracker.get_uptime_history(db)
    except Exception as e:
        # If the database itself is unreachable we still want a valid
        # response so the frontend can show a red "down" state instead of
        # a raw error. We ARE executing this code right now, which means
        # the API server is responding — stamp last_checked on both cards
        # with the current time (the DB entry got "checked" by the ping
        # that just failed).
        from datetime import datetime, timezone

        now_iso = datetime.now(timezone.utc).isoformat()
        return {
            "overall_status": "down",
            "services": [
                {
                    "id": "api",
                    "label": "API Server",
                    "description": "Cortex backend",
                    "current_status": "operational",
                    "last_checked": now_iso,
                    "uptime_24h": None,
                    "uptime_7d": None,
                    "sample_count_24h": 0,
                    "sample_count_7d": 0,
                    "days": [],
                },
                {
                    "id": "database",
                    "label": "Database",
                    "description": "MongoDB Atlas",
                    "current_status": "down",
                    "last_checked": now_iso,
                    "uptime_24h": None,
                    "uptime_7d": None,
                    "sample_count_24h": 0,
                    "sample_count_7d": 0,
                    "days": [],
                },
            ],
            "generated_at": now_iso,
            "error": "database_unavailable",
        }


