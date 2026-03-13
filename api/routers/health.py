"""
Health check endpoints for Kubernetes/Docker orchestration.

Provides /health (liveness), /ready (readiness), and /status (dashboard) probes.
"""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response, status

from db import get_database
from config import COUNCIL_MODELS, CHAIRMAN_MODEL, settings
from core.circuit_breaker import get_circuit_breaker_status
from core.dependencies import verify_api_key

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
async def status_check(response: Response):
    """
    Status Dashboard Endpoint

    Returns comprehensive system status for the frontend status page.
    Combines health, readiness, model info, and configuration.
    """
    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "llm-council-api",
        "environment": settings.environment,
    }

    # System checks
    checks = {}
    is_healthy = True

    # API Server (always healthy if responding)
    checks["api_server"] = {"status": "operational", "detail": "Responding to requests"}

    # MongoDB
    try:
        db = await get_database()
        start = datetime.now(timezone.utc)
        await asyncio.wait_for(db.command("ping"), timeout=2.0)
        latency_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        checks["mongodb"] = {
            "status": "operational",
            "detail": f"Connected ({latency_ms:.0f}ms latency)",
        }
    except asyncio.TimeoutError:
        checks["mongodb"] = {"status": "degraded", "detail": "Connection timeout"}
        is_healthy = False
    except Exception:
        checks["mongodb"] = {"status": "down", "detail": "Connection failed"}
        is_healthy = False

    # Circuit Breaker (Anthropic)
    try:
        breaker = get_circuit_breaker_status("anthropic")
        state = breaker.get("state", "unknown")
        if state == "open":
            checks["anthropic_circuit"] = {
                "status": "degraded",
                "detail": f"Circuit open — {breaker.get('fail_counter', '?')}/{breaker.get('fail_max', '?')} failures",
            }
            is_healthy = False
        elif state == "half-open":
            checks["anthropic_circuit"] = {
                "status": "degraded",
                "detail": "Circuit half-open — testing recovery",
            }
        else:
            checks["anthropic_circuit"] = {
                "status": "operational",
                "detail": "Circuit closed — normal operation",
            }
    except Exception:
        checks["anthropic_circuit"] = {"status": "unknown", "detail": "Unable to check"}

    # API Keys configured
    providers = {}
    providers["anthropic"] = {
        "configured": bool(settings.anthropic_api_key),
        "models": [m["name"] for m in COUNCIL_MODELS if m["provider"] == "anthropic"]
        + [CHAIRMAN_MODEL["name"]],
    }
    providers["groq"] = {
        "configured": bool(settings.groq_api_key),
        "models": [m["name"] for m in COUNCIL_MODELS if m["provider"] == "groq"],
    }

    # Models
    models = {
        "council_members": [
            {"id": m["id"], "name": m["name"], "provider": m["provider"]}
            for m in COUNCIL_MODELS
        ],
        "chairman": {
            "id": CHAIRMAN_MODEL["id"],
            "name": CHAIRMAN_MODEL["name"],
            "provider": CHAIRMAN_MODEL["provider"],
        },
    }

    result["overall_status"] = "operational" if is_healthy else "degraded"
    result["checks"] = checks
    result["providers"] = providers
    result["models"] = models

    if not is_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return result


@router.get("/metrics")
async def metrics_endpoint(_auth: bool = Depends(verify_api_key)):
    """Prometheus Metrics Endpoint. Requires authentication."""
    try:
        from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

        metrics = generate_latest()
        return Response(content=metrics, media_type=CONTENT_TYPE_LATEST)
    except ImportError:
        return {
            "error": "Prometheus client not installed",
            "message": "Install prometheus-client to enable metrics",
        }
