"""
Health check endpoints for Kubernetes/Docker orchestration.

Provides /health (liveness), /ready (readiness), and /status (dashboard) probes.
"""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response, status

from db import get_database
from config import CHAT_MODEL, settings
from core.circuit_breaker import get_circuit_breaker_status
from core.dependencies import get_current_user

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """
    Liveness Probe

    Returns 200 if the application is running.
    """
    return {"status": "healthy", "service": "cortex-api"}


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


