"""Tests for SSRF protections in URL validation."""

from unittest.mock import patch
import pytest
from services.url_extractor import (
    validate_url,
    validate_url_async,
    _is_blocked_host,
    _check_ips,
    _resolve_ips,
)


# ── Unit tests: blocklist (no DNS, no network) ──


class TestIsBlockedHost:
    """Test the host blocklist checker."""

    def test_blocks_localhost(self):
        assert _is_blocked_host("localhost") is True

    def test_blocks_loopback_ipv4(self):
        assert _is_blocked_host("127.0.0.1") is True

    def test_blocks_loopback_ipv6(self):
        assert _is_blocked_host("::1") is True

    def test_blocks_private_10(self):
        assert _is_blocked_host("10.0.0.1") is True

    def test_blocks_private_172(self):
        assert _is_blocked_host("172.16.0.1") is True

    def test_blocks_private_192(self):
        assert _is_blocked_host("192.168.1.1") is True

    def test_blocks_link_local(self):
        assert _is_blocked_host("169.254.1.1") is True

    def test_blocks_metadata_endpoint(self):
        assert _is_blocked_host("169.254.169.254") is True

    def test_blocks_zero_address(self):
        assert _is_blocked_host("0.0.0.0") is True

    def test_allows_public_ip(self):
        assert _is_blocked_host("8.8.8.8") is False

    def test_allows_public_hostname(self):
        assert _is_blocked_host("example.com") is False


class TestCheckIps:
    """Test IP validation logic directly."""

    def test_allows_public_ips(self):
        result = _check_ips(["93.184.216.34", "8.8.8.8"])
        assert result == ["93.184.216.34", "8.8.8.8"]

    def test_rejects_private_ip(self):
        with pytest.raises(ValueError, match="not allowed"):
            _check_ips(["192.168.1.1"])

    def test_rejects_loopback(self):
        with pytest.raises(ValueError, match="not allowed"):
            _check_ips(["127.0.0.1"])

    def test_rejects_link_local(self):
        with pytest.raises(ValueError, match="not allowed"):
            _check_ips(["169.254.169.254"])

    def test_rejects_mixed_with_private(self):
        with pytest.raises(ValueError, match="not allowed"):
            _check_ips(["93.184.216.34", "10.0.0.1"])


# ── Sync validate_url (uses real DNS but only for sync resolver) ──


class TestValidateUrl:
    """Test sync URL validation with SSRF protections."""

    def test_rejects_localhost(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_url("http://localhost/admin")

    def test_rejects_private_ip(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_url("http://192.168.1.1/secret")

    def test_rejects_loopback(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_url("http://127.0.0.1:8080/internal")

    def test_rejects_metadata(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_url("http://169.254.169.254/latest/meta-data/")

    def test_rejects_file_scheme(self):
        with pytest.raises(ValueError, match="not supported"):
            validate_url("file:///etc/passwd")

    def test_rejects_data_scheme(self):
        with pytest.raises(ValueError, match="not supported"):
            validate_url("data:text/html,<h1>pwned</h1>")

    def test_accepts_public_url(self):
        result = validate_url("https://example.com/article")
        assert "example.com" in result

    def test_adds_https_scheme(self):
        result = validate_url("example.com/page")
        assert result.startswith("https://")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="required"):
            validate_url("")

    def test_strips_tracking_params(self):
        result = validate_url("https://example.com/page?utm_source=test&id=1")
        assert "utm_source" not in result
        assert "id=1" in result


# ── Async validate_url_async (DNS mocked for determinism) ──


class TestValidateUrlAsync:
    """Test async URL validation with SSRF protections."""

    @pytest.mark.asyncio
    async def test_rejects_localhost(self):
        with pytest.raises(ValueError, match="not allowed"):
            await validate_url_async("http://localhost/admin")

    @pytest.mark.asyncio
    async def test_rejects_private_ip(self):
        with pytest.raises(ValueError, match="not allowed"):
            await validate_url_async("http://192.168.1.1/secret")

    @pytest.mark.asyncio
    async def test_rejects_loopback(self):
        with pytest.raises(ValueError, match="not allowed"):
            await validate_url_async("http://127.0.0.1:8080/internal")

    @pytest.mark.asyncio
    async def test_rejects_metadata(self):
        with pytest.raises(ValueError, match="not allowed"):
            await validate_url_async("http://169.254.169.254/latest/meta-data/")

    @pytest.mark.asyncio
    async def test_rejects_file_scheme(self):
        with pytest.raises(ValueError, match="not supported"):
            await validate_url_async("file:///etc/passwd")

    @pytest.mark.asyncio
    async def test_rejects_data_scheme(self):
        with pytest.raises(ValueError, match="not supported"):
            await validate_url_async("data:text/html,<h1>pwned</h1>")

    @pytest.mark.asyncio
    async def test_dns_resolving_to_loopback(self):
        """localhost is caught by _is_blocked_host before DNS."""
        with pytest.raises(ValueError, match="not allowed"):
            await validate_url_async("http://localhost/test")

    @pytest.mark.asyncio
    async def test_accepts_public_url_with_mocked_dns(self):
        """Mock DNS so the test does not depend on network."""
        with patch("services.url_extractor._resolve_ips", return_value=["93.184.216.34"]):
            url, ips = await validate_url_async("https://example.com/article")
        assert "example.com" in url
        assert ips == ["93.184.216.34"]

    @pytest.mark.asyncio
    async def test_returns_resolved_ips(self):
        with patch("services.url_extractor._resolve_ips", return_value=["1.2.3.4", "5.6.7.8"]):
            url, ips = await validate_url_async("https://example.com")
        assert len(ips) == 2
        assert "1.2.3.4" in ips

    @pytest.mark.asyncio
    async def test_blocks_hostname_resolving_to_private(self):
        """A hostname that resolves to a private IP must be rejected."""
        with patch("services.url_extractor._resolve_ips", return_value=["10.0.0.1"]):
            with pytest.raises(ValueError, match="not allowed"):
                await validate_url_async("https://evil.example.com")

    @pytest.mark.asyncio
    async def test_blocks_mixed_public_private_resolution(self):
        """If any resolved IP is private, reject the whole request."""
        with patch("services.url_extractor._resolve_ips", return_value=["93.184.216.34", "192.168.1.1"]):
            with pytest.raises(ValueError, match="not allowed"):
                await validate_url_async("https://sneaky.example.com")

    @pytest.mark.asyncio
    async def test_dns_timeout_raises(self):
        """DNS timeout must raise, not silently allow the request."""
        import time

        def slow_resolve(hostname):
            time.sleep(10)
            return []

        with patch("services.url_extractor._resolve_ips", side_effect=slow_resolve):
            with patch("services.url_extractor._DNS_TIMEOUT", 0.1):
                with pytest.raises(ValueError, match="timed out"):
                    await validate_url_async("https://slow-dns.example.com")

    @pytest.mark.asyncio
    async def test_dns_failure_raises(self):
        """Unresolvable hostname must raise, not silently pass."""
        import socket
        with patch("services.url_extractor._resolve_ips", side_effect=socket.gaierror("NXDOMAIN")):
            with pytest.raises(ValueError, match="Could not resolve"):
                await validate_url_async("https://nonexistent.invalid")
