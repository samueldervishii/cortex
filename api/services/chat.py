"""Simple chat service using a single Anthropic model."""

import json
import time
from typing import AsyncGenerator, List, Optional

from clients import AIClient
from config import CHAT_MODEL
from core.logging import logger
from . import usage_service


def _sse_event(event: str, data: dict) -> str:
    """Format a server-sent event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Truncation settings
# Keep first message (original question) + last N messages to stay within context limits.
# ~200K token context / ~500 tokens per message = ~400 messages max.
# We use 40 as a safe limit (leaves room for system prompt + file content).
MAX_HISTORY_MESSAGES = 40

# Flush every token immediately. The frontend runs a requestAnimationFrame
# drain loop that smooths burst arrivals into a steady typewriter effect,
# so there's no point batching on the server — it only adds latency.
TOKEN_BATCH_SIZE = 1


class ChatService:
    """Simple chat service using a single Anthropic model."""

    def __init__(self, client: AIClient):
        self.client = client

    def _truncate_history(self, history: List[dict]) -> List[dict]:
        """Truncate conversation history to stay within context limits.

        Keeps the first message (original context) + a truncation notice +
        the most recent messages so the total never exceeds
        ``MAX_HISTORY_MESSAGES``.
        """
        if len(history) <= MAX_HISTORY_MESSAGES:
            return history

        # first (1) + notice (1) + recent (N) = MAX_HISTORY_MESSAGES
        recent_count = MAX_HISTORY_MESSAGES - 2
        first = history[:1]
        recent = history[-recent_count:]
        return first + [{"role": "system", "content": "[Earlier messages truncated for brevity]"}] + recent

    def _build_prompt(self, question: str, history: List[dict]) -> str:
        """Build a prompt with conversation history."""
        if not history:
            return question

        # Truncate if too long
        history = self._truncate_history(history)

        parts = []
        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                parts.append(f"User: {content}")
            elif role == "system":
                parts.append(f"[{content}]")
            else:
                parts.append(f"Assistant: {content}")

        parts.append(f"User: {question}")
        return "\n\n".join(parts)

    def _compute_response_budget(self, remaining_tokens: Optional[int]) -> tuple[int, int]:
        """Decide max_tokens and thinking budget for the upcoming response.

        When we know how many tokens the user has left in their 5-hour bucket,
        we scale the output budget accordingly so a single response can never
        push them past the hard cap. Thinking budget is capped separately so
        it can't eat the whole output.

        Returns (max_tokens, thinking_budget).
        """
        thinking = usage_service.THINKING_BUDGET
        ceiling = usage_service.MODEL_MAX_TOKENS

        if remaining_tokens is None:
            # Caller didn't supply a limit — use the full ceiling.
            return ceiling, thinking

        # Floor: thinking + 4k output. The /stream endpoint already blocks
        # requests below this via RESPONSE_TOKEN_RESERVE, so we should never
        # actually see a value smaller than this here.
        floor = thinking + 4000
        max_tokens = max(floor, min(ceiling, remaining_tokens))
        return max_tokens, thinking

    async def stream_response(
        self,
        question: str,
        history: Optional[List[dict]] = None,
        system_prompt: Optional[str] = None,
        remaining_tokens: Optional[int] = None,
        model: Optional[dict] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream a response from the AI model with token batching.

        Args:
            remaining_tokens: tokens left in the user's 5-hour bucket. When
                provided, max_tokens is scaled down so a single response can
                never push the user past the cap.
            model: optional model registry entry to use instead of the
                default. The caller is responsible for resolving/validating
                the client-supplied model key before passing it here.

        Yields SSE events: message_start, token, message_end, done.
        Tokens are batched for snappier UI rendering.
        """
        model = model or CHAT_MODEL
        prompt = self._build_prompt(question, history or [])
        start_time = time.time()
        response_parts: list[str] = []
        token_buffer = ""
        token_count = 0
        input_tokens = 0
        output_tokens = 0

        max_tokens, thinking_budget = self._compute_response_budget(remaining_tokens)

        yield _sse_event("message_start", {
            "model_id": model["id"],
            "model_name": model["name"],
        })

        try:
            async for event_type, content in self.client.stream_chat(
                model_id=model["id"],
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=max_tokens,
                thinking_budget=thinking_budget,
            ):
                if event_type == "thinking":
                    yield _sse_event("thinking", {"content": content})
                    continue

                if event_type == "web_search":
                    yield _sse_event("web_search", {})
                    continue

                if event_type == "usage":
                    # content is a dict here, not a string
                    input_tokens = int(content.get("input_tokens", 0) or 0)
                    output_tokens = int(content.get("output_tokens", 0) or 0)
                    continue

                response_parts.append(content)
                token_buffer += content
                token_count += 1

                # Flush buffer when batch size reached
                if token_count >= TOKEN_BATCH_SIZE:
                    yield _sse_event("token", {"content": token_buffer})
                    token_buffer = ""
                    token_count = 0

            # Flush any remaining tokens
            if token_buffer:
                yield _sse_event("token", {"content": token_buffer})

            full_response = "".join(response_parts)
            elapsed_ms = int((time.time() - start_time) * 1000)
            yield _sse_event("message_end", {
                "model_id": model["id"],
                "content": full_response,
                "response_time_ms": elapsed_ms,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            })

        except Exception:
            logger.exception("Streaming error")
            yield _sse_event("error", {"message": "An error occurred while generating the response. Please try again."})

        yield _sse_event("done", {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        })
