import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from config import COUNCIL_MODELS, CHAIRMAN_MODEL, settings
from core import setup_logging
from core.dependencies import (
    get_session_repository,
    get_settings_repository,
    close_llm_client,
)
from core.metrics import init_metrics, track_request
from db import get_database, close_database, ensure_indexes
from routers import sessions_router, models_router, shared_router, settings_router
from routers.health import router as health_router
from routers.folders import router as folders_router
from routers.sessions import create_session
from schemas import QueryRequest, SessionResponse

# Configure logging
setup_logging()
logger = logging.getLogger("llm-council.requests")


async def run_auto_delete_cleanup(silent: bool = False):
    """Run auto-delete cleanup based on user settings."""
    try:
        session_repo = await get_session_repository()
        settings_repo = await get_settings_repository()

        user_settings = await settings_repo.get(user_id="default")

        # Check if auto_delete beta feature is enabled
        if "auto_delete" not in (user_settings.enabled_beta_features or []):
            if not silent:
                print("Auto-delete: Feature not enabled, skipping cleanup")
            return 0

        # Check if auto_delete_days is configured
        if user_settings.auto_delete_days is None:
            if not silent:
                print("Auto-delete: No retention period configured, skipping cleanup")
            return 0

        # Validate days value
        valid_days = [30, 60, 90]
        if user_settings.auto_delete_days not in valid_days:
            if not silent:
                print(
                    f"Auto-delete: Invalid retention period {user_settings.auto_delete_days}, skipping"
                )
            return 0

        # Run cleanup
        deleted_count = await session_repo.soft_delete_older_than(
            days=user_settings.auto_delete_days, include_pinned=False
        )

        if deleted_count > 0:
            print(
                f"Auto-delete: Cleaned up {deleted_count} sessions older than {user_settings.auto_delete_days} days"
            )
        elif not silent:
            print(
                f"Auto-delete: No sessions older than {user_settings.auto_delete_days} days to clean up"
            )

        return deleted_count

    except Exception as e:
        print(f"Auto-delete cleanup failed: {e}")
        return 0


# Background task reference (to cancel on shutdown)
_auto_delete_task: asyncio.Task | None = None

# Cleanup interval: 24 hours (in seconds)
AUTO_DELETE_INTERVAL = 24 * 60 * 60


async def auto_delete_background_task():
    """Background task that runs auto-delete cleanup periodically."""
    print("Auto-delete: Background scheduler started (runs every 24 hours)")
    while True:
        try:
            # Wait for the interval before running (cleanup already runs on startup)
            await asyncio.sleep(AUTO_DELETE_INTERVAL)
            # Run cleanup silently (only log if something was deleted)
            await run_auto_delete_cleanup(silent=True)
        except asyncio.CancelledError:
            print("Auto-delete: Background scheduler stopped")
            break
        except Exception as e:
            print(f"Auto-delete: Background task error: {e}")
            # Continue running even if there's an error
            await asyncio.sleep(60)  # Wait a minute before retrying


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan handler."""
    global _auto_delete_task
    print("LLM Council API starting...")
    print(f"Council members: {[m['name'] for m in COUNCIL_MODELS]}")
    print(f"Chairman: {CHAIRMAN_MODEL['name']}")

    # Initialize Prometheus metrics
    init_metrics()
    print("Metrics initialized")

    # Connect to MongoDB with timeout
    print(f"Connecting to MongoDB at {settings.mongodb_url}...")
    try:
        db = await get_database()
        # Ping to verify connection with 10 second timeout
        await asyncio.wait_for(db.command("ping"), timeout=10.0)
        print(f"MongoDB connected successfully (database: {settings.mongodb_database})")

        # Create indexes for optimal query performance
        await ensure_indexes(db)
        print("MongoDB indexes ensured")

        # Run auto-delete cleanup on startup
        await run_auto_delete_cleanup()

        # Start background task for periodic auto-delete
        _auto_delete_task = asyncio.create_task(auto_delete_background_task())
    except asyncio.TimeoutError:
        print("MongoDB ping timeout after 10 seconds - proceeding anyway")
    except Exception as e:
        print(f"MongoDB connection failed: {e}")

    yield
    print("LLM Council API shutting down...")

    # Cancel auto-delete background task
    if _auto_delete_task is not None:
        _auto_delete_task.cancel()
        try:
            await _auto_delete_task
        except asyncio.CancelledError:
            pass

    # Close HTTP clients gracefully
    await close_llm_client()
    print("LLM client closed")

    # Close database connection
    await close_database()
    print("MongoDB connection closed")


# Read version from root version.json
VERSION_FILE = Path(__file__).parent.parent / "version.json"
with open(VERSION_FILE) as f:
    VERSION = json.load(f)["version"]

DESCRIPTION = """
# LLM Council API

A powerful framework for querying multiple Large Language Models simultaneously and synthesizing their collective intelligence.

## Overview

The LLM Council enables you to:
- **Query multiple LLMs** in parallel with a single question
- **Collect peer reviews** where each model evaluates others' responses
- **Synthesize a final answer** using a chairman model that considers all perspectives

## How It Works

1. **Create a Session** - Start a new council session with your question
2. **Collect Responses** - Each council member (LLM) provides their answer
3. **Peer Review** - Models review and rank each other's responses
4. **Synthesis** - The chairman analyzes all responses and reviews to produce a final, well-rounded answer

## Quick Start

Use `/session/{id}/run-all` to execute the full council process in one call, or step through each phase individually for more control.
"""

tags_metadata = [
    {
        "name": "sessions",
        "description": "Manage council sessions - create, retrieve, delete, and run the council deliberation process.",
    },
    {
        "name": "models",
        "description": "View configured council member models and the chairman model.",
    },
    {
        "name": "settings",
        "description": "User settings and preferences - configure timeouts, analytics, debug mode, and other options.",
    },
]

# Disable docs in production
is_production = settings.environment == "production"

app = FastAPI(
    title="LLM Council API",
    description=DESCRIPTION,
    version=VERSION,
    lifespan=lifespan,
    openapi_tags=tags_metadata,
    contact={
        "name": "LLM Council",
    },
    license_info={
        "name": "MIT",
    },
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
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request logging and metrics middleware
@app.middleware("http")
async def log_and_track_requests(request: Request, call_next):
    """Log all HTTP requests with timing and track metrics."""
    start_time = time.time()

    # Get client IP (handle proxy headers)
    forwarded = request.headers.get("X-Forwarded-For")
    client_ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "unknown")
    )

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
app.include_router(health_router)  # Health checks and metrics
app.include_router(sessions_router)
app.include_router(models_router)
app.include_router(shared_router)
app.include_router(settings_router)
app.include_router(folders_router)


@app.get("/", tags=["health"])
async def root():
    """
    Health Check

    Returns the current status and version of the API.
    Use this endpoint to verify the API is running.
    """
    return {"message": "LLM Council API", "status": "running", "version": VERSION}


# Legacy endpoint for frontend compatibility
@app.post("/query", response_model=SessionResponse)
async def query(request: QueryRequest):
    """Start a new council session (legacy endpoint)."""
    repo = await get_session_repository()
    return await create_session(request, repo)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
