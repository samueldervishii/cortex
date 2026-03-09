"""
Circuit Breaker pattern for external API calls.

Prevents cascading failures by temporarily blocking requests to failing services.
"""

import logging
from functools import wraps
from typing import Optional, Callable, Any

from config import settings

logger = logging.getLogger("llm-council.circuit_breaker")

# Global circuit breaker instances
_breakers: dict[str, Any] = {}


def get_circuit_breaker(name: str = "default"):
    """
    Get or create a circuit breaker instance.

    Args:
        name: Unique name for this circuit breaker
    """
    global _breakers

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

            # If circuit breaker is not available, call function directly
            if breaker is None:
                return await func(*args, **kwargs)

            try:
                # Check if circuit is open before calling
                # current_state can be a string or an object with .name attribute
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

                # Call the async function directly (bypass call_async which needs Tornado)
                # We track failures manually via the breaker's state
                try:
                    result = await func(*args, **kwargs)
                    # Record success - reset fail counter
                    if hasattr(breaker, "close"):
                        breaker.close()  # This resets the breaker to closed state
                    return result
                except Exception:
                    # Record failure - this may trip the breaker
                    if hasattr(breaker, "_inc_counter"):
                        breaker._inc_counter()
                    # Check if we should open the circuit
                    if breaker.fail_counter >= breaker.fail_max:
                        if hasattr(breaker, "open"):
                            breaker.open()
                    raise

            except Exception:
                # Re-raise the exception
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
