"""
Health check endpoints for Kubernetes/Docker orchestration.

Provides /health (liveness) and /ready (readiness) probes.
"""

import asyncio
from fastapi import APIRouter, Response, status

from db import get_database
from core.circuit_breaker import get_circuit_breaker_status

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """
    Liveness Probe

    Returns 200 if the application is running.
    """
    return {"status": "healthy", "service": "llm-council-api"}


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
        checks["mongodb"] = f"unhealthy: {str(e)[:50]}"
        is_ready = False

    # Check Circuit Breaker
    try:
        breaker_status = get_circuit_breaker_status("anthropic")
        checks["circuit_breaker"] = breaker_status.get("state", "unknown")
        if breaker_status.get("state") == "open":
            is_ready = False
    except Exception as e:
        checks["circuit_breaker"] = f"error: {str(e)[:50]}"

    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if is_ready else "not_ready", "checks": checks}


@router.get("/metrics")
async def metrics_endpoint():
    """Prometheus Metrics Endpoint."""
    try:
        from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

        metrics = generate_latest()
        return Response(content=metrics, media_type=CONTENT_TYPE_LATEST)
    except ImportError:
        return {
            "error": "Prometheus client not installed",
            "message": "Install prometheus-client to enable metrics",
        }
