"""
Prometheus metrics for monitoring and observability.

Tracks:
- Request counts and latencies
- Rate limit hits
- Circuit breaker state
- Database query performance
"""

import logging
import time
from functools import wraps
from typing import Callable

logger = logging.getLogger("llm-council.metrics")

# Global metrics objects
_metrics_initialized = False
_request_counter = None
_request_latency = None
_rate_limit_counter = None
_db_query_latency = None
_llm_request_counter = None
_llm_request_latency = None


def init_metrics():
    """Initialize Prometheus metrics."""
    global _metrics_initialized
    global _request_counter, _request_latency
    global _rate_limit_counter, _db_query_latency
    global _llm_request_counter, _llm_request_latency

    if _metrics_initialized:
        return

    try:
        from prometheus_client import Counter, Histogram

        _request_counter = Counter(
            "http_requests_total",
            "Total HTTP requests",
            ["method", "endpoint", "status"],
        )

        _request_latency = Histogram(
            "http_request_duration_seconds",
            "HTTP request latency",
            ["method", "endpoint"],
        )

        _rate_limit_counter = Counter(
            "rate_limit_hits_total", "Rate limit hits", ["client_type"]
        )

        _db_query_latency = Histogram(
            "db_query_duration_seconds",
            "Database query latency",
            ["operation", "collection"],
        )

        _llm_request_counter = Counter(
            "llm_requests_total",
            "LLM API requests",
            ["model", "status"],
        )

        _llm_request_latency = Histogram(
            "llm_request_duration_seconds", "LLM request latency", ["model"]
        )

        _metrics_initialized = True
        logger.info("Prometheus metrics initialized")

    except ImportError:
        logger.warning("prometheus-client not installed. Metrics disabled.")


def track_request(method: str, endpoint: str, status: int, duration: float):
    """Track HTTP request metrics."""
    if _request_counter is not None:
        _request_counter.labels(method=method, endpoint=endpoint, status=status).inc()

    if _request_latency is not None:
        _request_latency.labels(method=method, endpoint=endpoint).observe(duration)


def track_rate_limit(client_type: str = "api"):
    """Track rate limit hits."""
    if _rate_limit_counter is not None:
        _rate_limit_counter.labels(client_type=client_type).inc()


def track_db_query(operation: str, collection: str, duration: float):
    """Track database query performance."""
    if _db_query_latency is not None:
        _db_query_latency.labels(operation=operation, collection=collection).observe(
            duration
        )


def track_llm_request(model: str, status: str, duration: float = None):
    """Track LLM API requests."""
    if _llm_request_counter is not None:
        _llm_request_counter.labels(model=model, status=status).inc()

    if _llm_request_latency is not None and duration is not None:
        _llm_request_latency.labels(model=model).observe(duration)


def timed_operation(metric_func: Callable):
    """Decorator to time an operation and record metrics."""

    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            start = time.time()
            try:
                result = await func(*args, **kwargs)
                duration = time.time() - start
                metric_func(duration)
                return result
            except Exception as e:
                duration = time.time() - start
                try:
                    metric_func(duration)
                except Exception:
                    pass
                raise e

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            start = time.time()
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start
                metric_func(duration)
                return result
            except Exception as e:
                duration = time.time() - start
                try:
                    metric_func(duration)
                except Exception:
                    pass
                raise e

        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator
