import asyncio
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from config import CHAT_MODEL, settings
from core import setup_logging
from core.dependencies import (
    get_session_repository,
    get_settings_repository,
    close_ai_client,
)
from core.metrics import init_metrics, track_request
from db import get_database, close_database, ensure_indexes
from routers import (
    sessions_router,
    shared_router,
    settings_router,
    auth_router,
    sources_router,
    usage_router,
)
from routers.health import router as health_router



# Configure logging
setup_logging()
logger = logging.getLogger("cortex.requests")


async def run_auto_delete_cleanup(silent: bool = False):
    """Run auto-delete cleanup for all users with auto_delete configured."""
    try:
        session_repo = await get_session_repository()
        settings_repo = await get_settings_repository()

        # Get all user settings that have auto_delete_days configured
        all_settings = await settings_repo.get_all_with_auto_delete()

        if not all_settings:
            if not silent:
                logger.info("Auto-delete: No users with auto-delete configured, skipping")
            return 0

        valid_days = [30, 60, 90]
        total_deleted = 0

        for user_settings in all_settings:
            if user_settings.auto_delete_days not in valid_days:
                continue

            deleted_count = await session_repo.purge_older_than(
                days=user_settings.auto_delete_days,
                include_pinned=False,
                user_id=user_settings.user_id,
            )
            total_deleted += deleted_count

            if deleted_count > 0:
                logger.info(
                    f"Auto-delete: Cleaned up {deleted_count} sessions for user {user_settings.user_id} "
                    f"(older than {user_settings.auto_delete_days} days)"
                )

        if total_deleted == 0 and not silent:
            logger.info("Auto-delete: No sessions to clean up across all users")

        return total_deleted

    except Exception as e:
        logger.info(f"Auto-delete cleanup failed: {e}")
        return 0


# Reference to the background auto-delete task. Stored globally so we can
# cancel it cleanly during shutdown (see lifespan handler below).
_auto_delete_task: asyncio.Task | None = None

# Cleanup interval: 24 hours (in seconds)
AUTO_DELETE_INTERVAL = 24 * 60 * 60


async def auto_delete_background_task():
    """Background task that runs auto-delete cleanup periodically."""
    logger.info("Auto-delete: Background scheduler started (runs every 24 hours)")
    while True:
        try:
            # Wait for the interval before running (cleanup already runs on startup)
            await asyncio.sleep(AUTO_DELETE_INTERVAL)
            # Run cleanup silently (only log if something was deleted)
            await run_auto_delete_cleanup(silent=True)
        except asyncio.CancelledError:
            logger.info("Auto-delete: Background scheduler stopped")
            break
        except Exception as e:
            logger.info(f"Auto-delete: Background task error: {e}")
            # Continue running even if there's an error
            await asyncio.sleep(60)  # Wait a minute before retrying


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan handler."""
    global _auto_delete_task
    logger.info("Cortex API starting...")
    logger.info(f"AI Model: {CHAT_MODEL['name']}")

    # Initialize Prometheus metrics
    init_metrics()
    logger.info("Metrics initialized")

    # Warn if per-process rate limiting may be ineffective
    from core.rate_limit import check_rate_limiter_deployment
    check_rate_limiter_deployment()

    # Connect to MongoDB with timeout (mask credentials in log output)
    masked_url = re.sub(
        r"://([^:]+):([^@]+)@", r"://\1:****@", settings.mongodb_url
    )
    logger.info(f"Connecting to MongoDB at {masked_url}...")
    try:
        db = await get_database()
        # Ping to verify connection with 10 second timeout
        await asyncio.wait_for(db.command("ping"), timeout=10.0)
        logger.info(f"MongoDB connected successfully (database: {settings.mongodb_database})")
    except asyncio.TimeoutError:
        logger.error("MongoDB ping timeout after 10 seconds — proceeding without DB")
        db = None
    except Exception as e:
        logger.error(f"MongoDB connection failed: {type(e).__name__}")
        db = None

    if db is not None:
        # Index creation: critical failures raise RuntimeError and abort startup.
        await ensure_indexes(db)
        logger.info("MongoDB indexes ensured")

        # Non-critical: migrations and cleanup may fail without blocking startup.
        try:
            from db.migrations import run_all_migrations
            await run_all_migrations(db)
        except Exception as e:
            logger.warning(f"Data migration failed (non-critical): {e}")

        try:
            await run_auto_delete_cleanup()
        except Exception as e:
            logger.warning(f"Auto-delete cleanup failed (non-critical): {e}")

        # Start background task for periodic auto-delete
        _auto_delete_task = asyncio.create_task(auto_delete_background_task())

    yield
    logger.info("Cortex API shutting down...")

    # Cancel auto-delete background task
    if _auto_delete_task is not None:
        _auto_delete_task.cancel()
        try:
            await _auto_delete_task
        except asyncio.CancelledError:
            pass

    # Close HTTP clients gracefully
    await close_ai_client()
    logger.info("LLM client closed")

    # Close database connection
    await close_database()
    logger.info("MongoDB connection closed")


# Read version from root version.json
VERSION_FILE = Path(__file__).parent.parent / "version.json"
with open(VERSION_FILE) as f:
    VERSION = json.load(f)["version"]

DESCRIPTION = """
# Cortex API

A clean AI chat platform powered by Claude Sonnet 4.6.

## Overview

- **Chat sessions** with persistent conversation history
- **Token-level SSE streaming** for real-time responses
- **User authentication** with JWT tokens
- **Session management** — pin, share, export, auto-delete

## Quick Start

1. `POST /session` — Create a new chat session
2. `POST /session/{id}/stream` — Stream the AI response via SSE
3. `POST /session/{id}/continue` — Send a follow-up message
"""

tags_metadata = [
    {
        "name": "sessions",
        "description": "Manage chat sessions — create, continue, stream, and organize conversations.",
    },
    {
        "name": "settings",
        "description": "User preferences — auto-delete, data export.",
    },
]

# Disable docs in production
is_production = settings.environment == "production"

app = FastAPI(
    title="Cortex API" if not is_production else "API",
    description=DESCRIPTION if not is_production else "",
    version=VERSION if not is_production else "",
    lifespan=lifespan,
    openapi_tags=tags_metadata if not is_production else [],
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)

# CORS middleware
# Default development origins + any production origins from env
cors_origins = ["http://localhost:5173", "http://localhost:3000"]
if settings.cors_origins:
    cors_origins.extend(
        [
            origin.strip()
            for origin in settings.cors_origins.split(",")
            if origin.strip()
        ]
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization"],
)


# Request body size limits
MAX_REQUEST_BODY_SIZE = 1 * 1024 * 1024        # 1MB for normal requests
MAX_UPLOAD_BODY_SIZE = 10 * 1024 * 1024        # 10MB for file upload routes


@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    """Reject requests with bodies larger than the allowed limit.

    Checks Content-Length when present, and also wraps the body stream
    to enforce the limit even when Content-Length is missing or forged.
    """
    limit = MAX_UPLOAD_BODY_SIZE if "/upload-file" in request.url.path else MAX_REQUEST_BODY_SIZE

    # Fast-path: reject early if Content-Length exceeds limit
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            size = int(content_length)
        except ValueError:
            size = 0
        if size > limit:
            from fastapi.responses import JSONResponse
            max_mb = limit // (1024 * 1024)
            return JSONResponse(
                status_code=413,
                content={"detail": f"Request body too large. Maximum size is {max_mb}MB."},
            )

    # Streaming enforcement: wrap body to count bytes regardless of headers
    if request.method in ("POST", "PUT", "PATCH"):
        original_body = request._receive
        bytes_read = 0

        async def _limited_receive():
            nonlocal bytes_read
            message = await original_body()
            body = message.get("body", b"")
            bytes_read += len(body)
            if bytes_read > limit:
                from fastapi.responses import JSONResponse
                raise HTTPException(
                    status_code=413,
                    detail=f"Request body too large. Maximum size is {limit // (1024 * 1024)}MB.",
                )
            return message

        request._receive = _limited_receive

    return await call_next(request)


# Security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "frame-ancestors 'none'"
    )
    response.headers["Server"] = "Cortex"
    if settings.environment == "production":
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )
    return response


# Request logging and metrics middleware
@app.middleware("http")
async def log_and_track_requests(request: Request, call_next):
    """Log all HTTP requests with timing and track metrics."""
    start_time = time.time()

    # Get client IP — same trust model as rate_limit._get_client_id
    from core.rate_limit import _TRUSTED_PROXY_DEPTH
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded and settings.environment == "production":
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        depth = min(_TRUSTED_PROXY_DEPTH, len(parts)) if parts else 0
        client_ip = parts[-depth] if depth else (request.client.host if request.client else "unknown")
    else:
        client_ip = (request.client.host if request.client else "unknown")

    # Process request
    response = await call_next(request)

    # Calculate duration
    duration = time.time() - start_time
    duration_ms = duration * 1000

    # Log request details
    logger.info(
        f"{request.method} {request.url.path} "
        f"[{response.status_code}] "
        f"{duration_ms:.1f}ms "
        f"client={client_ip}"
    )

    # Track metrics
    track_request(
        method=request.method,
        endpoint=request.url.path,
        status=response.status_code,
        duration=duration,
    )

    return response


# Include routers
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(sources_router)
app.include_router(shared_router)
app.include_router(settings_router)
app.include_router(usage_router)



@app.api_route("/", methods=["GET", "HEAD"], tags=["health"])
async def root():
    """
    Health Check

    Accepts both GET and HEAD so platform health checks (Render pings
    HEAD /) don't get stuck on 405 and fail to promote the deploy.
    Returns the current status of the API.
    """
    return {"status": "ok"}



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
