from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # API Keys
    anthropic_api_key: str = ""

    # MongoDB
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_database: str = "thesis_db"

    # CORS - comma-separated list of allowed origins for production
    cors_origins: str = ""

    # Environment - set to "production" to disable docs endpoints
    environment: str = "development"

    # API Authentication - optional API key for protecting endpoints
    # If set, requests must include X-API-Key header
    api_key: str = ""

    # JWT Authentication
    jwt_secret_key: str = ""  # Required for auth; generate with: openssl rand -hex 32
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    # Rate limiting
    rate_limit_requests: int = 100  # requests per window
    rate_limit_window: int = 60  # window in seconds

    # Circuit Breaker settings
    circuit_breaker_fail_max: int = 5  # Open circuit after 5 failures
    circuit_breaker_timeout: int = 60  # Try again after 60 seconds

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Validate critical secrets in production
if settings.environment == "production":
    if not settings.jwt_secret_key or len(settings.jwt_secret_key) < 32:
        raise RuntimeError(
            "CRITICAL: JWT_SECRET_KEY is missing or too short (min 32 chars) in production. "
            "Generate one with: openssl rand -hex 32"
        )
    if not settings.anthropic_api_key:
        raise RuntimeError("CRITICAL: ANTHROPIC_API_KEY is required in production.")

# Available chat models. Clients may pass a `model_id` with each stream
# request to pick one; anything outside this registry is rejected.
MODELS = {
    "claude-sonnet-4-6": {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6",
        "short_name": "Sonnet 4.6",
        "description": "Most efficient for everyday tasks",
        "provider": "anthropic",
    },
    "claude-opus-4-6": {
        "id": "claude-opus-4-6",
        "name": "Claude Opus 4.6",
        "short_name": "Opus 4.6",
        "description": "Most powerful for complex reasoning",
        "provider": "anthropic",
    },
    "claude-haiku-4-5": {
        "id": "claude-haiku-4-5-20251001",
        "name": "Claude Haiku 4.5",
        "short_name": "Haiku 4.5",
        "description": "Fastest, lowest cost",
        "provider": "anthropic",
    },
}

# Default model used when the client doesn't specify one.
DEFAULT_MODEL_KEY = "claude-sonnet-4-6"
CHAT_MODEL = MODELS[DEFAULT_MODEL_KEY]


def resolve_model(model_key: str | None) -> dict:
    """Return the model registry entry for a client-supplied key.

    Falls back to the default model when the key is missing or unknown.
    Never raises — invalid input should degrade gracefully to the default.
    """
    if not model_key:
        return CHAT_MODEL
    return MODELS.get(model_key, CHAT_MODEL)
