"""Consistent UTC timestamp formatting for API responses and persistence."""

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return current UTC time as a timezone-aware datetime."""
    return datetime.now(timezone.utc)


def utc_iso(dt: datetime | None = None) -> str:
    """Format a UTC datetime as ISO 8601 with Z suffix.

    If dt is None, uses current UTC time.
    Strips tzinfo before formatting to avoid '+00:00Z' malformation.
    """
    if dt is None:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat() + "Z"
