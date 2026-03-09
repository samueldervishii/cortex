from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # API Keys
    anthropic_api_key: str = ""
    groq_api_key: str = ""

    # MongoDB
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_database: str = "llm_council"

    # CORS - comma-separated list of allowed origins for production
    cors_origins: str = ""

    # Environment - set to "production" to disable docs endpoints
    environment: str = "development"

    # API Authentication - optional API key for protecting endpoints
    # If set, requests must include X-API-Key header or api_key query param
    api_key: str = ""

    # Rate limiting
    rate_limit_requests: int = 100  # requests per window
    rate_limit_window: int = 60  # window in seconds

    # Circuit Breaker settings
    circuit_breaker_fail_max: int = 5  # Open circuit after 5 failures
    circuit_breaker_timeout: int = 60  # Try again after 60 seconds

    class Config:
        env_file = ".env"


settings = Settings()

# Council member models
COUNCIL_MODELS = [
    {
        "id": "claude-haiku-4-5-20251001",
        "name": "Claude Haiku 4.5",
        "provider": "anthropic",
    },
    {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B",
        "provider": "groq",
    },
    {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B",
        "provider": "groq",
    },
    {
        "id": "qwen/qwen3-32b",
        "name": "Qwen 3 32B",
        "provider": "groq",
    },
]

# Head of the Council - Claude Sonnet 4.6 moderates and leads debates
CHAIRMAN_MODEL = {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6",
    "provider": "anthropic",
}
