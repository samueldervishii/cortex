"""Tests for client IP extraction in rate limiting."""

from unittest.mock import MagicMock, patch
from core.rate_limit import RateLimiter


def _make_request(forwarded_for=None, client_ip="1.2.3.4"):
    """Create a mock Request with optional X-Forwarded-For header."""
    request = MagicMock()
    request.client.host = client_ip
    headers = {}
    if forwarded_for is not None:
        headers["X-Forwarded-For"] = forwarded_for
    request.headers = headers
    return request


class TestClientIdExtraction:
    """Test _get_client_id with various proxy configurations."""

    def setup_method(self):
        self.limiter = RateLimiter(requests_per_window=10, window_seconds=60)

    def test_direct_connection_no_proxy(self):
        """Without X-Forwarded-For, use direct client IP."""
        request = _make_request(client_ip="9.8.7.6")
        with patch("core.rate_limit.settings") as mock_settings:
            mock_settings.environment = "development"
            result = self.limiter._get_client_id(request)
        assert result == "9.8.7.6"

    def test_production_single_proxy_rightmost(self):
        """With single trusted proxy, rightmost X-Forwarded-For value is the real client."""
        request = _make_request(forwarded_for="spoofed.ip, real.client.ip")
        with patch("core.rate_limit.settings") as mock_settings:
            mock_settings.environment = "production"
            result = self.limiter._get_client_id(request)
        assert result == "real.client.ip"

    def test_production_single_value(self):
        """Single-value X-Forwarded-For in production."""
        request = _make_request(forwarded_for="client.ip")
        with patch("core.rate_limit.settings") as mock_settings:
            mock_settings.environment = "production"
            result = self.limiter._get_client_id(request)
        assert result == "client.ip"

    def test_development_ignores_forwarded(self):
        """In development, X-Forwarded-For is ignored."""
        request = _make_request(forwarded_for="1.1.1.1", client_ip="127.0.0.1")
        with patch("core.rate_limit.settings") as mock_settings:
            mock_settings.environment = "development"
            result = self.limiter._get_client_id(request)
        assert result == "127.0.0.1"
