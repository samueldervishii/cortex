import asyncio
import json
import logging
import re
from typing import AsyncGenerator, Optional

import httpx

from config import settings
from core.circuit_breaker import with_circuit_breaker

logger = logging.getLogger("cortex.llm_client")

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


class LLMClient:
    """Multi-provider LLM client supporting Anthropic and Groq APIs."""

    ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
    GROQ_BASE_URL = "https://api.groq.com/openai/v1"
    ANTHROPIC_VERSION = "2023-06-01"

    def __init__(self):
        self.anthropic_api_key = settings.anthropic_api_key
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the reusable HTTP client with connection pooling."""
        if self._client is None or self._client.is_closed:
            # Close the old client before replacing it to free its connections
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
    async def _chat_anthropic(
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
            error_detail = response.text
            logger.error(
                f"Anthropic error for {model_id}: {response.status_code} - {error_detail}"
            )
            raise Exception(
                f"Anthropic API error ({response.status_code}): {error_detail}"
            )

        data = response.json()

        if "error" in data:
            error_msg = data["error"].get("message", str(data["error"]))
            logger.error(f"Anthropic error for {model_id}: {error_msg}")
            raise Exception(f"Model error: {error_msg}")

        # Anthropic response format: content[0].text
        content_blocks = data.get("content", [])
        if not content_blocks:
            logger.error(f"Invalid response from {model_id}: {data}")
            raise Exception("Invalid response from model (no content returned)")

        content = content_blocks[0].get("text", "")
        logger.info(f"Anthropic response from {model_id}: {len(content)} chars")
        return content

    @with_circuit_breaker(
        breaker_name="groq",
        fallback=lambda *args,
        **kwargs: "Service temporarily unavailable. Please try again in a moment.",
    )
    async def _chat_groq(
        self,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> str:
        """Send a chat request to the Groq API (OpenAI-compatible)."""
        logger.info(f"Groq request to model: {model_id}")

        headers = {
            "Authorization": f"Bearer {self.groq_api_key}",
            "Content-Type": "application/json",
        }

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model_id,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        client = await self._get_client()
        response = await self._request_with_retry(
            client,
            "POST",
            f"{self.GROQ_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )

        if response.status_code != 200:
            error_detail = response.text
            logger.error(
                f"Groq error for {model_id}: {response.status_code} - {error_detail}"
            )
            raise Exception(
                f"Groq API error ({response.status_code}): {error_detail}"
            )

        data = response.json()

        if "error" in data:
            error_msg = data["error"].get("message", str(data["error"]))
            logger.error(f"Groq error for {model_id}: {error_msg}")
            raise Exception(f"Model error: {error_msg}")

        if "choices" not in data or not data["choices"]:
            logger.error(f"Invalid response from {model_id}: {data}")
            raise Exception("Invalid response from model (no choices returned)")

        content = data["choices"][0]["message"]["content"]
        logger.info(f"Groq response from {model_id}: {len(content)} chars")
        return content

    async def _stream_anthropic(
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
                raise Exception(
                    f"Anthropic API error ({response.status_code}): {body.decode()}"
                )

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

    async def _stream_groq(
        self,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from the Groq API (OpenAI-compatible)."""
        logger.info(f"Groq streaming request to model: {model_id}")

        headers = {
            "Authorization": f"Bearer {self.groq_api_key}",
            "Content-Type": "application/json",
        }

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model_id,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }

        client = await self._get_client()
        async with client.stream(
            "POST",
            f"{self.GROQ_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise Exception(
                    f"Groq API error ({response.status_code}): {body.decode()}"
                )

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError as e:
                    logger.debug(f"Failed to parse Groq stream data: {e}")
                    continue

                choices = data.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        yield content

    async def stream_chat(
        self,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        provider: str = "anthropic",
    ) -> AsyncGenerator[str, None]:
        """
        Stream tokens from the appropriate provider.

        Yields individual text chunks as they arrive.
        Automatically strips <think> blocks from streamed output.
        """
        in_think = False
        buffer = ""

        if provider == "anthropic":
            source = self._stream_anthropic(
                model_id, prompt, system_prompt, max_tokens, temperature
            )
        elif provider == "groq":
            source = self._stream_groq(
                model_id, prompt, system_prompt, max_tokens, temperature
            )
        else:
            raise ValueError(f"Unsupported provider: {provider}")

        # Stream tokens while stripping <think>...</think> blocks in real-time.
        # Groq models (e.g. Qwen) emit <think> blocks for chain-of-thought reasoning
        # that should not be shown to the user.
        #
        # The challenge: tokens arrive in small chunks, so a <think> tag may be split
        # across multiple chunks (e.g. "<thi" then "nk>"). We buffer text containing
        # a partial "<" until we can confirm whether it's a <think> tag or not.
        async for chunk in source:
            buffer += chunk

            while buffer:
                if in_think:
                    # Inside a think block — discard everything until </think>
                    end_idx = buffer.find("</think>")
                    if end_idx != -1:
                        buffer = buffer[end_idx + 8:]
                        in_think = False
                    else:
                        buffer = ""
                        break
                else:
                    start_idx = buffer.find("<think>")
                    if start_idx != -1:
                        # Found a think tag — yield text before it, discard the tag
                        if start_idx > 0:
                            yield buffer[:start_idx]
                        buffer = buffer[start_idx + 7:]
                        in_think = True
                    elif "<" in buffer and not buffer.endswith(">"):
                        # Buffer contains "<" but no closing ">" yet — could be a
                        # partial "<think>" tag split across chunks. Yield everything
                        # before the last "<" and hold the rest for the next chunk.
                        safe = buffer[:buffer.rfind("<")]
                        if safe:
                            yield safe
                        buffer = buffer[len(safe):]
                        break
                    else:
                        yield buffer
                        buffer = ""
                        break

        # Flush remaining buffer (unless we're mid-think block)
        if buffer and not in_think:
            yield buffer

    async def chat(
        self,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        provider: str = "anthropic",
    ) -> str:
        """
        Send a chat request to the appropriate provider.

        Args:
            model_id: The model identifier
            prompt: The user prompt
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature
            provider: "anthropic" or "groq"
        """
        if provider == "anthropic":
            response = await self._chat_anthropic(
                model_id, prompt, system_prompt, max_tokens, temperature
            )
        elif provider == "groq":
            response = await self._chat_groq(
                model_id, prompt, system_prompt, max_tokens, temperature
            )
        else:
            raise ValueError(f"Unsupported provider: {provider}")

        return self._strip_thinking(response)

    @staticmethod
    def _strip_thinking(text: str) -> str:
        """Strip <think>...</think> blocks from model responses.

        Handles both closed (<think>...</think>) and unclosed (<think>...) tags.
        """
        # First strip closed tags
        cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
        # Then strip unclosed <think> tag (takes everything from <think> to end)
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
        return cleaned.strip()
