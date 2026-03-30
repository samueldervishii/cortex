"""Simple chat service using a single Anthropic model."""

import json
import time
from typing import AsyncGenerator, List, Optional

from clients import LLMClient
from config import CHAT_MODEL
from core.logging import logger


def _sse_event(event: str, data: dict) -> str:
    """Format a server-sent event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Truncation settings
# Keep first message (original question) + last N messages to stay within context limits.
# ~200K token context / ~500 tokens per message = ~400 messages max.
# We use 40 as a safe limit (leaves room for system prompt + file content).
MAX_HISTORY_MESSAGES = 40

# Token batching: accumulate tokens and flush in chunks for snappier UI
TOKEN_BATCH_SIZE = 2  # flush every N tokens
TOKEN_BATCH_TIMEOUT = 0.05  # max seconds to hold tokens before flushing


class ChatService:
    """Simple chat service using a single Anthropic model."""

    def __init__(self, client: LLMClient):
        self.client = client

    def _truncate_history(self, history: List[dict]) -> List[dict]:
        """Truncate conversation history to stay within context limits.

        Keeps the first message (original context) + last N messages.
        """
        if len(history) <= MAX_HISTORY_MESSAGES:
            return history

        # Keep first message + last (MAX - 1) messages
        first = history[:1]
        recent = history[-(MAX_HISTORY_MESSAGES - 1):]
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

    async def stream_response(
        self,
        question: str,
        history: Optional[List[dict]] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream a response from the AI model with token batching.

        Yields SSE events: message_start, token, message_end, done.
        Tokens are batched for snappier UI rendering.
        """
        model = CHAT_MODEL
        prompt = self._build_prompt(question, history or [])
        start_time = time.time()
        full_response = ""
        token_buffer = ""
        token_count = 0

        yield _sse_event("message_start", {
            "model_id": model["id"],
            "model_name": model["name"],
        })

        try:
            async for token in self.client.stream_chat(
                model_id=model["id"],
                prompt=prompt,
                system_prompt=system_prompt,
                provider=model["provider"],
                max_tokens=8192,
            ):
                full_response += token
                token_buffer += token
                token_count += 1

                # Flush buffer when batch size reached
                if token_count >= TOKEN_BATCH_SIZE:
                    yield _sse_event("token", {"content": token_buffer})
                    token_buffer = ""
                    token_count = 0

            # Flush any remaining tokens
            if token_buffer:
                yield _sse_event("token", {"content": token_buffer})

            elapsed_ms = int((time.time() - start_time) * 1000)
            yield _sse_event("message_end", {
                "model_id": model["id"],
                "content": full_response,
                "response_time_ms": elapsed_ms,
            })

        except Exception as e:
            logger.error(f"Streaming error: {e}")
            yield _sse_event("error", {"message": str(e)})

        yield _sse_event("done", {})
