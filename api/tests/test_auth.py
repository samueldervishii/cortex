"""Tests for auth token creation with rotation claims."""

from core.auth import create_refresh_token, decode_token


class TestRefreshTokenRotation:
    """Test that refresh tokens include rotation tracking claims."""

    def test_refresh_token_has_jti(self):
        """Refresh tokens must include a unique jti claim."""
        token = create_refresh_token("user-1")
        payload = decode_token(token, expected_type="refresh")
        assert "jti" in payload
        assert len(payload["jti"]) > 0

    def test_refresh_token_has_family(self):
        """Refresh tokens must include a family claim."""
        token = create_refresh_token("user-1")
        payload = decode_token(token, expected_type="refresh")
        assert "family" in payload
        assert len(payload["family"]) > 0

    def test_custom_family_and_jti(self):
        """Explicit family_id and jti are embedded correctly."""
        token = create_refresh_token("user-1", family_id="fam-123", jti="jti-456")
        payload = decode_token(token, expected_type="refresh")
        assert payload["family"] == "fam-123"
        assert payload["jti"] == "jti-456"

    def test_two_tokens_different_jti(self):
        """Two tokens for the same user get different JTIs."""
        t1 = create_refresh_token("user-1")
        t2 = create_refresh_token("user-1")
        p1 = decode_token(t1, expected_type="refresh")
        p2 = decode_token(t2, expected_type="refresh")
        assert p1["jti"] != p2["jti"]

    def test_two_tokens_different_family(self):
        """Two tokens without explicit family get different families (separate logins)."""
        t1 = create_refresh_token("user-1")
        t2 = create_refresh_token("user-1")
        p1 = decode_token(t1, expected_type="refresh")
        p2 = decode_token(t2, expected_type="refresh")
        assert p1["family"] != p2["family"]
