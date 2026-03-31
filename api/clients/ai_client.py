import asyncio
import json
import logging
import re
from typing import AsyncGenerator, Optional

import httpx

from config import settings
from core.circuit_breaker import with_circuit_breaker

logger = logging.getLogger("cortex.ai_client")

# Retry configuration — exponential backoff (1s, 2s, 4s) for transient failures.
# 3 retries balances reliability vs. user wait time for LLM API calls.
MAX_RETRIES = 3
RETRY_DELAY_BASE = 1.0  # seconds; multiplied by 2^attempt for backoff
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

# Timeout configuration — tuned for LLM API response characteristics:
# - connect: 10s is generous for TLS handshake to cloud APIs
# - read: 120s because LLM responses (especially synthesis) can take 30-90s
# - write: 30s for sending large prompts with conversation history
# - pool: 10s to wait for a connection from the pool before failing
CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 120.0
WRITE_TIMEOUT = 30.0
POOL_TIMEOUT = 10.0

DEFAULT_TIMEOUT = httpx.Timeout(
    connect=CONNECT_TIMEOUT, read=READ_TIMEOUT, write=WRITE_TIMEOUT, pool=POOL_TIMEOUT
)


class AIClient:
    """Anthropic AI client for Claude API."""

    ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
    ANTHROPIC_VERSION = "2023-06-01"

    def __init__(self):
        self.anthropic_api_key = settings.anthropic_api_key
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the reusable HTTP client with connection pooling."""
        if self._client is None or self._client.is_closed:
            if self._client is not None:
                await self._client.aclose()
            self._client = httpx.AsyncClient(
                timeout=DEFAULT_TIMEOUT,
                limits=httpx.Limits(
                    max_keepalive_connections=20,
                    max_connections=50,
                    keepalive_expiry=30.0,
                ),
            )
        return self._client

    async def close(self):
        """Close HTTP client gracefully."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def _request_with_retry(
        self, client: httpx.AsyncClient, method: str, url: str, **kwargs
    ) -> httpx.Response:
        """Make HTTP request with exponential backoff retry."""
        last_exception = None

        for attempt in range(MAX_RETRIES):
            try:
                response = await client.request(method, url, **kwargs)

                if response.status_code in RETRYABLE_STATUS_CODES:
                    delay = RETRY_DELAY_BASE * (2**attempt)
                    logger.warning(
                        f"Retryable status {response.status_code}, "
                        f"attempt {attempt + 1}/{MAX_RETRIES}, waiting {delay}s"
                    )
                    await asyncio.sleep(delay)
                    continue

                return response

            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as e:
                last_exception = e
                delay = RETRY_DELAY_BASE * (2**attempt)
                logger.warning(
                    f"Network error: {type(e).__name__}, "
                    f"attempt {attempt + 1}/{MAX_RETRIES}, waiting {delay}s"
                )
                await asyncio.sleep(delay)

        if last_exception:
            raise last_exception
        raise Exception(f"Request failed after {MAX_RETRIES} retries")

    @with_circuit_breaker(
        breaker_name="anthropic",
        fallback=lambda *args,
        **kwargs: "Service temporarily unavailable. Please try again in a moment.",
    )
    async def chat(
        self,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> str:
        """Send a chat request to the Anthropic Messages API."""
        logger.info(f"Anthropic request to model: {model_id}")

        headers = {
            "x-api-key": self.anthropic_api_key,
            "anthropic-version": self.ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        payload = {
            "model": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }

        if system_prompt:
            payload["system"] = system_prompt

        client = await self._get_client()
        response = await self._request_with_retry(
            client,
            "POST",
            f"{self.ANTHROPIC_BASE_URL}/messages",
            headers=headers,
            json=payload,
        )

        if response.status_code != 200:
            logger.error(
                f"Anthropic error for {model_id}: {response.status_code} - {response.text[:500]}"
            )
            raise Exception("The AI service is temporarily unavailable. Please try again.")

        data = response.json()

        if "error" in data:
            logger.error(f"Anthropic error for {model_id}: {data['error']}")
            raise Exception("The AI service encountered an error. Please try again.")

        content_blocks = data.get("content", [])
        if not content_blocks:
            logger.error(f"Invalid response from {model_id}: empty content")
            raise Exception("No response received from the AI. Please try again.")

        content = content_blocks[0].get("text", "")
        logger.info(f"Anthropic response from {model_id}: {len(content)} chars")
        return content

    async def stream_chat(
        self,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from the Anthropic Messages API."""
        logger.info(f"Anthropic streaming request to model: {model_id}")

        headers = {
            "x-api-key": self.anthropic_api_key,
            "anthropic-version": self.ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        payload = {
            "model": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
            "messages": [{"role": "user", "content": prompt}],
        }

        if system_prompt:
            payload["system"] = system_prompt

        client = await self._get_client()
        async with client.stream(
            "POST",
            f"{self.ANTHROPIC_BASE_URL}/messages",
            headers=headers,
            json=payload,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                logger.error(f"Anthropic stream error: {response.status_code} - {body.decode()[:500]}")
                raise Exception("The AI service is temporarily unavailable. Please try again.")

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError as e:
                    logger.debug(f"Failed to parse Anthropic stream data: {e}")
                    continue

                event_type = data.get("type", "")
                if event_type == "content_block_delta":
                    delta = data.get("delta", {})
                    if delta.get("type") == "text_delta":
                        text = delta.get("text", "")
                        if text:
                            yield text
