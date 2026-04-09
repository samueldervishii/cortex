import time
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException, status

from config import settings

# Number of trusted reverse proxies between the client and this server.
# With 1 proxy (Render, Vercel), the real client IP is the rightmost
# X-Forwarded-For entry.  With 2 (e.g. Cloudflare → Render), use 2.
_TRUSTED_PROXY_DEPTH = 1


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


# Global rate limiter instance (general API rate limit)
rate_limiter = RateLimiter(
    requests_per_window=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window,
)

# Strict registration rate limiter: 3 registrations per IP per hour
registration_limiter = RateLimiter(
    requests_per_window=3,
    window_seconds=3600,
)


def check_rate_limiter_deployment() -> None:
    """Log a warning if per-process rate limiting may be ineffective.

    Called at startup. With multiple uvicorn workers each worker gets its
    own in-memory state, effectively multiplying the allowed rate.
    """
    import os
    workers = os.environ.get("WEB_CONCURRENCY", "1")
    try:
        n = int(workers)
    except ValueError:
        n = 1
    if n > 1:
        import logging
        logging.getLogger("cortex.rate_limit").warning(
            f"Running {n} workers with in-memory rate limiting. "
            f"Effective rate limit is {n}x configured value. "
            "For accurate limits, switch to Redis-backed rate limiting."
        )


class UserUsageTracker:
    """Track per-user daily message usage and enforce cooldowns.

    Prevents API cost abuse by limiting:
    - Max messages per user per day (default: 50)
    - Min delay between messages per user (default: 3 seconds)
    """

    def __init__(self, daily_limit: int = 50, cooldown_seconds: float = 3.0):
        self.daily_limit = daily_limit
        self.cooldown_seconds = cooldown_seconds
        # user_id -> list of timestamps (messages sent today)
        self._daily_usage: dict[str, list[float]] = defaultdict(list)
        # user_id -> timestamp of last message
        self._last_message: dict[str, float] = {}
        self._last_cleanup = time.time()

    def _cleanup(self, now: float) -> None:
        """Remove entries older than 24 hours."""
        if now - self._last_cleanup < 600:  # cleanup every 10 min
            return
        cutoff = now - 86400  # 24 hours
        stale = [uid for uid, ts in self._daily_usage.items()
                 if not ts or all(t < cutoff for t in ts)]
        for uid in stale:
            del self._daily_usage[uid]
            self._last_message.pop(uid, None)
        self._last_cleanup = now

    def check(self, user_id: str) -> None:
        """Check if user can send a message. Raises HTTPException if not."""
        now = time.time()
        self._cleanup(now)

        # Check cooldown (min delay between messages)
        last = self._last_message.get(user_id)
        if last and (now - last) < self.cooldown_seconds:
            wait = round(self.cooldown_seconds - (now - last), 1)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait}s before sending another message.",
                headers={"Retry-After": str(int(wait) + 1)},
            )

        # Check daily limit
        cutoff = now - 86400
        self._daily_usage[user_id] = [t for t in self._daily_usage[user_id] if t > cutoff]
        if len(self._daily_usage[user_id]) >= self.daily_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Daily message limit reached ({self.daily_limit} messages). Resets in 24 hours.",
            )

    def record(self, user_id: str) -> None:
        """Record a message sent by user."""
        now = time.time()
        self._daily_usage[user_id].append(now)
        self._last_message[user_id] = now

    def get_remaining(self, user_id: str) -> int:
        """Get remaining messages for user today."""
        now = time.time()
        cutoff = now - 86400
        self._daily_usage[user_id] = [t for t in self._daily_usage[user_id] if t > cutoff]
        return max(0, self.daily_limit - len(self._daily_usage[user_id]))


# Global user usage tracker
user_usage = UserUsageTracker(daily_limit=50, cooldown_seconds=3.0)


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
    """Strict registration rate limit (3 per IP per hour)."""
    is_allowed, retry_after = registration_limiter.is_allowed(request)
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )
