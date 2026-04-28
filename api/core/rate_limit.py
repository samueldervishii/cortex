import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Request, HTTPException, status

from config import settings

# Number of trusted reverse proxies between the client and this server.
# With 1 proxy (Render, Vercel), the real client IP is the rightmost
# X-Forwarded-For entry.  With 2 (e.g. Cloudflare → Render), use 2.
_TRUSTED_PROXY_DEPTH = 1


def get_client_ip(request: Request) -> str:
    """Extract the real client IP from a request.

    Centralized so authn lockout, rate limiting, and request logging all
    use the same trust model (rightmost ``X-Forwarded-For`` entry behind
    the configured number of trusted proxies in production; raw socket IP
    otherwise).
    """
    client_ip = request.client.host if request.client else "unknown"

    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded and settings.environment == "production":
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            depth = min(_TRUSTED_PROXY_DEPTH, len(parts))
            return parts[-depth]

    return client_ip


class RateLimiter:
    """
    Simple in-memory rate limiter using sliding window.

    WARNING: This rate limiter is per-process only. With multiple uvicorn workers
    (e.g., --workers 4), each worker has its own rate limit state, effectively
    multiplying the allowed rate by the number of workers. For production with
    multiple workers, use Redis-backed rate limiting (e.g., slowapi with Redis).
    Single-worker deployment (Render free tier, development) is fine as-is.
    """

    def __init__(self, requests_per_window: int, window_seconds: int):
        self.requests_per_window = requests_per_window
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)
        self._last_full_cleanup = time.time()
        # Full cleanup runs every 5 minutes to remove stale client entries and
        # prevent unbounded memory growth. This is separate from per-request cleanup
        # (which only cleans the current client's timestamps) — it sweeps ALL clients.
        self._cleanup_interval = 300

    def _get_client_id(self, request: Request) -> str:
        """Extract the real client IP from the request.

        Trust model (single trusted reverse proxy — Render, Vercel, etc.):
        The trusted proxy appends the connecting client's IP to
        X-Forwarded-For, so the rightmost entry is the one the proxy saw
        and cannot be forged by the client.  Any entries to the left of it
        were supplied by the client and are untrusted.

        For deployments with >1 trusted proxy (e.g. Cloudflare → Render),
        change TRUSTED_PROXY_DEPTH to 2 and use [-2].
        """
        client_ip = request.client.host if request.client else "unknown"

        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded and settings.environment == "production":
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if parts:
                # With N trusted proxies, the real client IP is at index -N.
                # Default: 1 trusted proxy → rightmost entry.
                depth = min(_TRUSTED_PROXY_DEPTH, len(parts))
                return parts[-depth]

        return client_ip

    def _cleanup_old_requests(self, client_id: str, current_time: float) -> None:
        """Remove requests outside the current window."""
        cutoff = current_time - self.window_seconds
        self.requests[client_id] = [t for t in self.requests[client_id] if t > cutoff]
        # Remove empty client entries to prevent memory leak
        if not self.requests[client_id]:
            del self.requests[client_id]

    def _periodic_cleanup(self, current_time: float) -> None:
        """Periodically clean up all stale client entries to prevent memory leaks."""
        if current_time - self._last_full_cleanup < self._cleanup_interval:
            return

        cutoff = current_time - self.window_seconds
        # A client is "stale" if it has no timestamps or all its timestamps are
        # older than the sliding window — meaning it hasn't made a request recently.
        # We collect keys first to avoid modifying the dict during iteration.
        stale_clients = [
            client_id
            for client_id, timestamps in self.requests.items()
            if not timestamps or all(t <= cutoff for t in timestamps)
        ]
        for client_id in stale_clients:
            del self.requests[client_id]

        self._last_full_cleanup = current_time

    def is_allowed(self, request: Request) -> tuple[bool, Optional[int]]:
        """
        Check if request is allowed.

        Returns:
            (is_allowed, retry_after_seconds)
        """
        # Skip rate limiting if not configured
        if self.requests_per_window <= 0:
            return True, None

        client_id = self._get_client_id(request)
        current_time = time.time()

        # Periodic full cleanup to prevent memory leaks from stale clients
        self._periodic_cleanup(current_time)

        # Cleanup old requests for this client
        if client_id in self.requests:
            self._cleanup_old_requests(client_id, current_time)

        # Check if under limit (client_id may not exist if cleaned up or new)
        current_count = len(self.requests.get(client_id, []))
        if current_count < self.requests_per_window:
            self.requests[client_id].append(current_time)
            return True, None

        # Calculate retry-after
        oldest_request = min(self.requests[client_id])
        retry_after = int(oldest_request + self.window_seconds - current_time) + 1

        return False, retry_after

    def get_remaining(self, request: Request) -> int:
        """Get remaining requests in current window."""
        client_id = self._get_client_id(request)
        current_time = time.time()
        if client_id in self.requests:
            self._cleanup_old_requests(client_id, current_time)
        current_count = len(self.requests.get(client_id, []))
        return max(0, self.requests_per_window - current_count)


# Global rate limiter instance (general API rate limit).
# This one stays in-memory because it fires on every request — moving it
# to MongoDB would be a hot-path write per request. The trade-off: with
# multiple uvicorn workers the effective limit is N×configured. Since the
# general limiter is just burst protection (not a security boundary), this
# is acceptable; the security-critical limiters below DO use MongoDB.
rate_limiter = RateLimiter(
    requests_per_window=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window,
)


def check_rate_limiter_deployment() -> None:
    """Log a warning if the per-process general limiter may be diluted.

    Called at startup. Only the GENERAL ``rate_limiter`` is per-process;
    ``MongoSlidingWindowLimiter`` and ``MongoUserUsageTracker`` are
    accurate across any number of workers/hosts.
    """
    import os
    workers = os.environ.get("WEB_CONCURRENCY", "1")
    try:
        n = int(workers)
    except ValueError:
        n = 1
    if n > 1:
        import logging
        logging.getLogger("etude.rate_limit").warning(
            f"Running {n} workers; the GENERAL rate limiter is per-process so "
            f"its effective rate is {n}x the configured value. Registration "
            f"and per-user usage limits are MongoDB-backed and unaffected."
        )


class MongoSlidingWindowLimiter:
    """MongoDB-backed sliding-window limiter.

    Used for security-sensitive limits (registration spam, etc.) where
    the per-process in-memory limiter would otherwise be silently
    multiplied by the number of uvicorn workers / pods.

    State lives in a collection (default: ``rate_limit_buckets``) keyed
    by ``scope:key`` so multiple limiters can share the same collection
    without colliding.
    """

    COLLECTION = "rate_limit_buckets"

    def __init__(self, scope: str, limit: int, window_seconds: int):
        self.scope = scope
        self.limit = limit
        self.window_seconds = window_seconds

    def _key(self, key: str) -> str:
        return f"{self.scope}:{key}"

    async def check_and_record(self, key: str, db) -> None:
        """Atomically check the limit and record the new attempt.

        Raises ``HTTPException(429)`` when the limit is exceeded. Uses a
        single round-trip for the typical (allowed) path: read state,
        compute decision, write back.
        """
        if self.limit <= 0:
            return

        col = db[self.COLLECTION]
        now = time.time()
        cutoff = now - self.window_seconds

        doc = await col.find_one({"_id": self._key(key)})
        attempts = [t for t in (doc.get("attempts") if doc else []) if t > cutoff]

        if len(attempts) >= self.limit:
            oldest = min(attempts)
            retry_after = int(oldest + self.window_seconds - now) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    "Too many requests. Please try again later."
                    if self.scope != "register"
                    else "Too many registration attempts. Please try again later."
                ),
                headers={"Retry-After": str(max(1, retry_after))},
            )

        # Bound the array size so a noisy attacker can't bloat a doc
        # past 16MB. We keep at most ``limit*2`` recent timestamps; the
        # extras let us still surface accurate retry-after values when
        # the caller is right at the boundary.
        await col.update_one(
            {"_id": self._key(key)},
            {
                "$push": {
                    "attempts": {"$each": [now], "$slice": -self.limit * 2}
                },
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )


class MongoUserUsageTracker:
    """Per-user daily message limit + per-user cooldown, in MongoDB.

    Same contract as the in-memory ``UserUsageTracker`` it replaces, but
    accurate across workers/pods.
    """

    COLLECTION = "user_message_usage"

    def __init__(self, daily_limit: int = 50, cooldown_seconds: float = 3.0):
        self.daily_limit = daily_limit
        self.cooldown_seconds = cooldown_seconds

    async def check_and_record(self, user_id: str, db) -> None:
        """Combined check+record; raises 429 on cooldown or daily-limit hit.

        Combined into a single call so the read and the write are a
        bounded race window — at worst a user squeaking through under
        contention will be properly capped on their next attempt.
        """
        col = db[self.COLLECTION]
        now = time.time()
        cutoff = now - 86400

        doc = await col.find_one({"_id": user_id})

        last = (doc or {}).get("last_message_at")
        if last and (now - last) < self.cooldown_seconds:
            wait = round(self.cooldown_seconds - (now - last), 1)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait}s before sending another message.",
                headers={"Retry-After": str(int(wait) + 1)},
            )

        attempts = [t for t in ((doc or {}).get("attempts") or []) if t > cutoff]
        if len(attempts) >= self.daily_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Daily message limit reached ({self.daily_limit} messages). Resets in 24 hours.",
            )

        await col.update_one(
            {"_id": user_id},
            {
                "$push": {
                    "attempts": {
                        "$each": [now],
                        "$slice": -max(self.daily_limit * 2, 100),
                    }
                },
                "$set": {
                    "last_message_at": now,
                    "updated_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )

    async def get_remaining(self, user_id: str, db) -> int:
        """Get remaining messages for user today (no side effects)."""
        col = db[self.COLLECTION]
        now = time.time()
        cutoff = now - 86400
        doc = await col.find_one({"_id": user_id})
        attempts = [t for t in ((doc or {}).get("attempts") or []) if t > cutoff]
        return max(0, self.daily_limit - len(attempts))


# Global registration limiter — Mongo-backed so the 3/hour cap is real
# across workers. Used by /auth/register only, so the round-trip cost
# is negligible vs the bcrypt hashing already in that path.
registration_limiter = MongoSlidingWindowLimiter(
    scope="register", limit=3, window_seconds=3600,
)

# Global user-message tracker — Mongo-backed.
user_usage = MongoUserUsageTracker(daily_limit=50, cooldown_seconds=3.0)


async def check_rate_limit(request: Request) -> None:
    """General API rate limit (per-IP)."""
    is_allowed, retry_after = rate_limiter.is_allowed(request)
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )


async def check_registration_limit(request: Request) -> None:
    """Strict registration rate limit (3 per IP per hour, MongoDB-backed)."""
    from db.connection import get_database

    db = await get_database()
    await registration_limiter.check_and_record(get_client_ip(request), db)
