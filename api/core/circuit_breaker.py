"""
Circuit Breaker pattern for external API calls.

Prevents cascading failures by temporarily blocking requests to failing services.
"""

import logging
import threading
from functools import wraps
from typing import Optional, Callable, Any

from config import settings

logger = logging.getLogger("llm-council.circuit_breaker")

# Global circuit breaker instances with lock for thread-safe initialization
_breakers: dict[str, Any] = {}
_breaker_lock = threading.Lock()


def get_circuit_breaker(name: str = "default"):
    """
    Get or create a circuit breaker instance.

    Args:
        name: Unique name for this circuit breaker
    """
    if name not in _breakers:
        with _breaker_lock:
            if name not in _breakers:
                try:
                    from pybreaker import CircuitBreaker

                    _breakers[name] = CircuitBreaker(
                        fail_max=settings.circuit_breaker_fail_max,
                        reset_timeout=settings.circuit_breaker_timeout,
                        name=name,
                        listeners=[CircuitBreakerLogger()],
                    )
                    logger.info(f"Circuit breaker '{name}' initialized")
                except ImportError:
                    logger.warning("pybreaker not installed. Circuit breaker disabled.")
                    _breakers[name] = None

    return _breakers[name]


class CircuitBreakerLogger:
    """Listener for circuit breaker events."""

    def state_change(self, cb, old_state, new_state):
        """Called when circuit breaker changes state."""
        logger.warning(
            f"Circuit breaker '{cb.name}' state changed: {old_state.name} -> {new_state.name}"
        )

    def failure(self, cb, exception):
        """Called on failure."""
        logger.debug(f"Circuit breaker '{cb.name}' recorded failure: {exception}")

    def success(self, cb):
        """Called on success."""
        logger.debug(f"Circuit breaker '{cb.name}' recorded success")


def with_circuit_breaker(
    breaker_name: str = "default", fallback: Optional[Callable] = None
):
    """
    Decorator to protect function with circuit breaker.

    Usage:
        @with_circuit_breaker(breaker_name="anthropic", fallback=lambda *args: "Service unavailable")
        async def call_external_api():
            # API call here
            pass

    Args:
        breaker_name: Name of the circuit breaker
        fallback: Optional fallback function to call when circuit is open
    """

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            breaker = get_circuit_breaker(breaker_name)

            # If pybreaker not installed, skip circuit breaking entirely
            if breaker is None:
                return await func(*args, **kwargs)

            try:
                # Circuit breaker states (pybreaker):
                #   closed    → normal operation, requests go through
                #   open      → too many failures, block all requests until reset_timeout
                #   half-open → after timeout, allow ONE request to test if service recovered
                #
                # pybreaker's current_state can be a string or object with .name,
                # depending on the version — getattr handles both.
                state = breaker.current_state
                state_name = getattr(state, "name", str(state)).lower()

                if state_name == "open":
                    logger.error(
                        f"Circuit breaker '{breaker_name}' is OPEN - requests blocked"
                    )
                    if fallback:
                        return fallback(*args, **kwargs)
                    raise Exception(
                        "Service temporarily unavailable (circuit breaker open)"
                    )

                # We call the async function directly instead of pybreaker's call_async()
                # because call_async() requires Tornado. We manually track state transitions.
                try:
                    result = await func(*args, **kwargs)
                    # Only transition to closed when recovering from half-open state.
                    # Important: calling close() in normal (closed) state would reset the
                    # fail counter on every successful request, preventing failures from
                    # ever accumulating to the threshold.
                    if state_name == "half-open" and hasattr(breaker, "close"):
                        breaker.close()
                    return result
                except Exception:
                    # Record failure — _inc_counter increments pybreaker's internal counter
                    if hasattr(breaker, "_inc_counter"):
                        breaker._inc_counter()
                    # Trip the breaker if we've hit the failure threshold
                    if breaker.fail_counter >= breaker.fail_max:
                        if hasattr(breaker, "open"):
                            breaker.open()
                    raise

            except Exception:
                raise

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            breaker = get_circuit_breaker(breaker_name)

            if breaker is None:
                return func(*args, **kwargs)

            try:
                return breaker.call(func, *args, **kwargs)
            except Exception as e:
                error_name = type(e).__name__
                if error_name == "CircuitBreakerError":
                    logger.error(
                        f"Circuit breaker '{breaker_name}' is OPEN - requests blocked"
                    )
                    if fallback:
                        return fallback(*args, **kwargs)
                    raise Exception(
                        "Service temporarily unavailable (circuit breaker open)"
                    )
                raise

        # Return appropriate wrapper
        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


def get_circuit_breaker_status(breaker_name: str = "default") -> dict:
    """
    Get status of a circuit breaker.

    Returns:
        {
            "state": "open|closed|half-open",
            "fail_counter": int,
            "last_failure": str
        }
    """
    breaker = get_circuit_breaker(breaker_name)

    if breaker is None:
        return {"state": "disabled", "fail_counter": 0}

    try:
        state = breaker.current_state
        state_name = getattr(state, "name", str(state))
        return {
            "name": breaker.name,
            "state": state_name,
            "fail_counter": breaker.fail_counter,
            "fail_max": breaker.fail_max,
            "reset_timeout": breaker.reset_timeout,
        }
    except Exception as e:
        logger.error(f"Failed to get circuit breaker status: {e}")
        return {"state": "unknown", "error": str(e)}
