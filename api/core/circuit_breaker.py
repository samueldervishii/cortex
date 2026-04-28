"""
Circuit Breaker pattern for external API calls.

Prevents cascading failures by temporarily blocking requests to failing services.

The async path manages state manually (pybreaker's ``call_async`` needs Tornado)
while still using pybreaker's ``CircuitBreaker`` as the underlying state/counter
storage.  Key invariants:

* **Consecutive failures** trip the breaker — a success resets the counter.
* After ``reset_timeout`` seconds in the OPEN state, **one** probe request is
  allowed (half-open).  If the probe succeeds the breaker closes; if it fails
  it reopens with a fresh timeout.
"""

import logging
import threading
import time
from functools import wraps
from typing import Optional, Callable, Any

from config import settings

logger = logging.getLogger("etude.circuit_breaker")

_breakers: dict[str, Any] = {}
_breaker_lock = threading.Lock()

# Monotonic timestamp of the last time each breaker was opened.  Used by the
# async path to decide when the reset_timeout has elapsed (pybreaker only
# checks this inside ``call()`` which we cannot use for async functions).
_breaker_opened_at: dict[str, float] = {}


def get_circuit_breaker(name: str = "default"):
    """Get or create a circuit breaker instance."""
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
        logger.warning(
            f"Circuit breaker '{cb.name}' state changed: {old_state.name} -> {new_state.name}"
        )

    def failure(self, cb, exception):
        logger.debug(f"Circuit breaker '{cb.name}' recorded failure: {exception}")

    def success(self, cb):
        logger.debug(f"Circuit breaker '{cb.name}' recorded success")


# ── Helpers for the async state machine ──────────────────────────────────

def _breaker_state_name(breaker) -> str:
    state = breaker.current_state
    return getattr(state, "name", str(state)).lower()


def _reset_counter(breaker) -> None:
    """Reset the consecutive-failure counter without triggering a state change."""
    try:
        breaker._state_storage.reset_counter()
    except AttributeError:
        pass


def _open_breaker(breaker, name: str) -> None:
    if hasattr(breaker, "open"):
        breaker.open()
    _breaker_opened_at[name] = time.monotonic()


def _close_breaker(breaker, name: str) -> None:
    if hasattr(breaker, "close"):
        breaker.close()
    _breaker_opened_at.pop(name, None)


# ── Public helpers for non-decorator usage (e.g. streaming) ──────────────

def check_breaker(name: str = "default") -> None:
    """Raise if the circuit breaker is OPEN and the cooldown hasn't elapsed.

    If the cooldown *has* elapsed the call succeeds (probe request allowed).
    Callers must follow up with ``record_breaker_success`` or
    ``record_breaker_failure`` once the outcome is known.
    """
    breaker = get_circuit_breaker(name)
    if breaker is None:
        return

    state = _breaker_state_name(breaker)
    if state == "open":
        opened_at = _breaker_opened_at.get(name, 0)
        if time.monotonic() - opened_at < breaker.reset_timeout:
            logger.error(f"Circuit breaker '{name}' is OPEN — request blocked")
            raise Exception("Service temporarily unavailable (circuit breaker open)")
        logger.info(f"Circuit breaker '{name}' cooldown elapsed — allowing probe request")


def record_breaker_success(name: str = "default") -> None:
    """Record a successful call — resets counter or closes after probe."""
    breaker = get_circuit_breaker(name)
    if breaker is None:
        return

    state = _breaker_state_name(breaker)
    if state in ("open", "half-open"):
        _close_breaker(breaker, name)
        logger.info(f"Circuit breaker '{name}' probe succeeded — closed")
    else:
        _reset_counter(breaker)


def record_breaker_failure(name: str = "default") -> None:
    """Record a failed call — increments counter and may trip the breaker."""
    breaker = get_circuit_breaker(name)
    if breaker is None:
        return

    state = _breaker_state_name(breaker)
    if state in ("open", "half-open"):
        _open_breaker(breaker, name)
        logger.warning(f"Circuit breaker '{name}' probe failed — reopened")
        return

    if hasattr(breaker, "_inc_counter"):
        breaker._inc_counter()
    if breaker.fail_counter >= breaker.fail_max:
        _open_breaker(breaker, name)


# ── Decorator ────────────────────────────────────────────────────────────

def with_circuit_breaker(
    breaker_name: str = "default", fallback: Optional[Callable] = None
):
    """Decorator to protect an async or sync function with the circuit breaker."""

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            breaker = get_circuit_breaker(breaker_name)

            if breaker is None:
                return await func(*args, **kwargs)

            try:
                check_breaker(breaker_name)
            except Exception:
                if fallback:
                    return fallback(*args, **kwargs)
                raise

            try:
                result = await func(*args, **kwargs)
                record_breaker_success(breaker_name)
                return result
            except Exception:
                record_breaker_failure(breaker_name)
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
                        f"Circuit breaker '{breaker_name}' is OPEN — requests blocked"
                    )
                    if fallback:
                        return fallback(*args, **kwargs)
                    raise Exception(
                        "Service temporarily unavailable (circuit breaker open)"
                    )
                raise

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
