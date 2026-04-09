"""Tests for UTC timestamp formatting."""

from datetime import datetime, timezone
from core.timestamps import utc_iso, utc_now


def test_utc_iso_no_double_offset():
    """utc_iso must never produce '+00:00Z' — only trailing 'Z'."""
    result = utc_iso()
    assert result.endswith("Z"), f"Expected trailing Z, got: {result}"
    assert "+00:00" not in result, f"Contains +00:00: {result}"
    assert result.count("Z") == 1


def test_utc_iso_with_aware_datetime():
    """Timezone-aware datetime should still produce clean 'Z' suffix."""
    dt = datetime(2025, 3, 15, 12, 30, 0, tzinfo=timezone.utc)
    result = utc_iso(dt)
    assert result == "2025-03-15T12:30:00Z"
    assert "+00:00" not in result


def test_utc_iso_with_naive_datetime():
    """Naive datetime should work and append Z."""
    dt = datetime(2025, 3, 15, 12, 30, 0)
    result = utc_iso(dt)
    assert result == "2025-03-15T12:30:00Z"


def test_utc_iso_defaults_to_now():
    """Calling utc_iso() with no args returns a valid timestamp."""
    result = utc_iso()
    # Should parse without error
    parsed = datetime.fromisoformat(result.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None


def test_utc_now_is_aware():
    """utc_now() must return timezone-aware datetime."""
    now = utc_now()
    assert now.tzinfo is not None
