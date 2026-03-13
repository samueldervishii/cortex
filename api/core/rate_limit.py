import time
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException, status

from config import settings


class RateLimiter:
    """
    Simple in-memory rate limiter using sliding window.

    For production with multiple workers, consider using Redis.
    """

    def __init__(self, requests_per_window: int, window_seconds: int):
        self.requests_per_window = requests_per_window
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)
        self._last_full_cleanup = time.time()
        self._cleanup_interval = 300  # Full cleanup every 5 minutes

    def _get_client_id(self, request: Request) -> str:
        """Get unique identifier for the client."""
        # Use X-Forwarded-For if behind a proxy, otherwise use client host
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # Take the first IP in the chain (original client)
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

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
        # Create list of keys to avoid modifying dict during iteration
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


# Global rate limiter instance
rate_limiter = RateLimiter(
    requests_per_window=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window,
)


async def check_rate_limit(request: Request) -> None:
    """
    Dependency to check rate limit.

    Usage:
        @router.post("/endpoint")
        async def endpoint(request: Request, _rate_limit: None = Depends(check_rate_limit)):
            ...
    """
    is_allowed, retry_after = rate_limiter.is_allowed(request)

    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
