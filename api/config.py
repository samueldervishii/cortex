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

# The single AI model used for all conversations
CHAT_MODEL = {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6",
    "provider": "anthropic",
}
