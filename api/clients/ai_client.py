import asyncio
import json
import logging
import re
from typing import Any, AsyncGenerator, Optional

import httpx

from config import settings
from core.circuit_breaker import with_circuit_breaker

logger = logging.getLogger("cortex.ai_client")


def _clean_title(raw: str) -> str:
    """Normalize a model-generated title: strip quotes, prefixes, trailing punctuation."""
    t = (raw or "").strip()
    if not t:
        return ""
    # Strip surrounding quotes (straight or curly)
    quote_pairs = (('"', '"'), ("'", "'"), ("\u201c", "\u201d"), ("\u2018", "\u2019"))
    for open_q, close_q in quote_pairs:
        if t.startswith(open_q) and t.endswith(close_q) and len(t) >= 2:
            t = t[len(open_q) : -len(close_q)].strip()
            break
    # Strip a "Title:" prefix if the model ignored the instruction
    if t.lower().startswith("title:"):
        t = t[6:].strip()
    # Strip trailing punctuation
    t = t.rstrip(".!?\u2026 ")
    # Collapse internal whitespace
    t = re.sub(r"\s+", " ", t)
    return t[:80]

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
                f"Anthropic error for {model_id}: status={response.status_code}"
            )
            raise Exception("The AI service is temporarily unavailable. Please try again.")

        data = response.json()

        if "error" in data:
            logger.error(f"Anthropic error for {model_id}: type={data['error'].get('type', 'unknown') if isinstance(data['error'], dict) else 'unknown'}")
            raise Exception("The AI service encountered an error. Please try again.")

        content_blocks = data.get("content", [])
        if not content_blocks:
            logger.error(f"Invalid response from {model_id}: empty content")
            raise Exception("No response received from the AI. Please try again.")

        content = content_blocks[0].get("text", "")
        logger.info(f"Anthropic response from {model_id}: {len(content)} chars")
        return content

    async def generate_session_title(
        self, question: str, answer: str, model_id: str
    ) -> str:
        """Distill a user question + assistant answer into a short chat title.

        Returns a cleaned 3-5 word title, or an empty string on failure.
        Failures are non-fatal — the caller keeps the old title.
        """
        system_prompt = (
            "You generate short chat titles. Given a user message and the "
            "assistant's reply, output a 3-5 word title summarizing what the "
            "conversation is about. Rules: output ONLY the title, no quotes, "
            "no trailing punctuation, no prefix like 'Title:'. Be specific."
        )
        # Truncate inputs so the call stays cheap even when the user pasted
        # a huge first message or the assistant wrote a long response.
        prompt = (
            f"User message:\n{(question or '').strip()[:500]}\n\n"
            f"Assistant reply:\n{(answer or '').strip()[:500]}\n\n"
            f"Title:"
        )
        try:
            raw = await self.chat(
                model_id=model_id,
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=30,
                temperature=0.3,
            )
        except Exception as e:
            logger.warning(f"Title generation failed: {e}")
            return ""
        return _clean_title(raw)

    async def stream_chat(
        self,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        thinking_budget: int = 12000,
    ) -> AsyncGenerator[tuple[str, Any], None]:
        """Stream tokens from the Anthropic Messages API.

        Args:
            thinking_budget: explicit cap on tokens Claude may spend thinking.
                Must be >= 1024 and strictly less than max_tokens.

        Yields (event_type, content) tuples:
        - ("text", token) for text tokens
        - ("thinking", text) for thinking blocks
        - ("web_search", "") when web search is triggered
        - ("usage", {"input_tokens": N, "output_tokens": N}) as a final event
        """
        from core.circuit_breaker import check_breaker, record_breaker_success, record_breaker_failure

        check_breaker("anthropic")

        logger.info(f"Anthropic streaming request to model: {model_id}")

        headers = {
            "x-api-key": self.anthropic_api_key,
            "anthropic-version": self.ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        # Clamp thinking budget: Anthropic requires >=1024 and <max_tokens.
        # Leave at least 4k for visible output when the caller passes a tight
        # max_tokens (near end of a user's 5-hour bucket).
        safe_thinking = max(1024, min(thinking_budget, max_tokens - 4000))
        if safe_thinking >= max_tokens:
            safe_thinking = max_tokens - 1

        # Anthropic requires temperature=1 when extended thinking is enabled.
        payload = {
            "model": model_id,
            "max_tokens": max_tokens,
            "temperature": 1,  # required by Anthropic thinking mode
            "stream": True,
            "messages": [{"role": "user", "content": prompt}],
            "thinking": {"type": "enabled", "budget_tokens": safe_thinking},
            "tools": [
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 3},
            ],
        }

        if system_prompt:
            payload["system"] = system_prompt

        client = await self._get_client()
        _cb_recorded = False
        try:
            async with client.stream(
                "POST",
                f"{self.ANTHROPIC_BASE_URL}/messages",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code != 200:
                    record_breaker_failure("anthropic")
                    _cb_recorded = True
                    await response.aread()
                    logger.error(f"Anthropic stream error: status={response.status_code}")
                    raise Exception("The AI service is temporarily unavailable. Please try again.")

                current_block_type = None
                input_tokens = 0
                output_tokens = 0

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

                    if event_type == "message_start":
                        msg_usage = data.get("message", {}).get("usage", {}) or {}
                        input_tokens = int(msg_usage.get("input_tokens", 0) or 0)

                    elif event_type == "message_delta":
                        delta_usage = data.get("usage", {}) or {}
                        if "output_tokens" in delta_usage:
                            output_tokens = int(delta_usage.get("output_tokens", 0) or 0)

                    elif event_type == "content_block_start":
                        block = data.get("content_block", {})
                        current_block_type = block.get("type", "text")

                        if current_block_type == "server_tool_use":
                            yield ("web_search", "")

                    elif event_type == "content_block_delta":
                        delta = data.get("delta", {})
                        delta_type = delta.get("type", "")

                        if delta_type == "thinking_delta":
                            text = delta.get("thinking", "")
                            if text:
                                yield ("thinking", text)
                        elif delta_type == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                yield ("text", text)

                    elif event_type == "content_block_stop":
                        current_block_type = None

                yield ("usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})

            record_breaker_success("anthropic")
            _cb_recorded = True
        except Exception:
            if not _cb_recorded:
                record_breaker_failure("anthropic")
            raise
        finally:
            if not _cb_recorded:
                record_breaker_success("anthropic")
