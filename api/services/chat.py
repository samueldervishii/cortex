"""Simple chat service using a single Anthropic model."""

import json
import time
from typing import AsyncGenerator, List, Optional, Tuple

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

# How many recent messages to always preserve verbatim. Anything older
# gets compressed into the conversation summary when truncation triggers.
RECENT_MESSAGES_VERBATIM = MAX_HISTORY_MESSAGES - 1

# Flush every token immediately. The frontend runs a requestAnimationFrame
# drain loop that smooths burst arrivals into a steady typewriter effect,
# so there's no point batching on the server — it only adds latency.
TOKEN_BATCH_SIZE = 1


class ChatService:
    """Simple chat service using a single Anthropic model."""

    def __init__(self, client: AIClient):
        self.client = client

    def _truncate_history(
        self, history: List[dict]
    ) -> Tuple[List[dict], Optional[str], List[dict], int]:
        """Truncate conversation history to stay within context limits.

        Keeps the first message (original context) and the most recent
        messages. When truncation actually happens we also return:

          * a short notice string the caller can append to the system
            prompt (we do NOT inject a synthetic ``role: system`` entry
            into the messages list because Anthropic only accepts
            ``user`` / ``assistant`` there),
          * the dropped middle messages, so the caller can summarize
            them out-of-band, and
          * how many leading messages of ``history`` are now represented
            outside the active context window (first message + dropped
            middle), to be passed to the summary cache as ``through``.

        Returns ``(history, notice, dropped, through)``. When no
        truncation is needed, ``notice`` is ``None``, ``dropped`` is
        empty and ``through`` is ``0``.
        """
        if len(history) <= MAX_HISTORY_MESSAGES:
            return history, None, [], 0

        # first (1) + recent (N) = MAX_HISTORY_MESSAGES
        recent_count = RECENT_MESSAGES_VERBATIM
        first = history[:1]
        recent = history[-recent_count:]
        dropped = history[1:-recent_count]
        # Number of leading messages now outside the verbatim window:
        # the first message + every dropped middle message.
        through = 1 + len(dropped)
        notice = (
            "Note: the earlier middle of this conversation has been omitted "
            "for brevity. The first message and the most recent exchanges "
            "are preserved verbatim."
        )
        return first + recent, notice, dropped, through

    @staticmethod
    def _is_block_list(content) -> bool:
        return isinstance(content, list)

    @staticmethod
    def _content_to_blocks(content) -> List[dict]:
        """Coerce a string or block-list into Anthropic block-list form."""
        if isinstance(content, list):
            return list(content)
        return [{"type": "text", "text": str(content or "")}]

    @staticmethod
    def _content_is_empty(content) -> bool:
        if isinstance(content, list):
            return len(content) == 0
        return not bool(content)

    @classmethod
    def _merge_contents(cls, a, b):
        """Merge two same-role contents into one.

        Plain strings stay strings (cheaper for the model to tokenize),
        but as soon as either side contains structured blocks (images
        etc) the result is a unified block list.
        """
        if isinstance(a, str) and isinstance(b, str):
            return a + "\n\n" + b
        return cls._content_to_blocks(a) + cls._content_to_blocks(b)

    def _build_messages(
        self, question, history: List[dict]
    ) -> Tuple[List[dict], Optional[str], List[dict], int]:
        """Build a clean Anthropic messages array from history + new question.

        Anthropic's Messages API requires that messages strictly alternate
        between ``user`` and ``assistant`` and start with ``user``. Real
        session data should always satisfy this, but we defensively
        normalize because:

          * Branching/continue endpoints could in theory leave two
            consecutive user messages.
          * Older sessions migrated from a prior schema may contain
            unexpected role values.

        Returns ``(messages, truncation_notice_or_None, dropped_middle, summary_through)``.
        """
        history, notice, dropped, through = self._truncate_history(list(history))

        # Drop anything that isn't user/assistant — and skip empties.
        cleaned: List[dict] = []
        for msg in history:
            role = msg.get("role")
            content = msg.get("content", "")
            if role not in ("user", "assistant") or self._content_is_empty(content):
                continue
            cleaned.append({"role": role, "content": content})

        # Collapse consecutive same-role messages. This keeps Anthropic's
        # alternation rule happy without losing any user-visible info.
        # ``_merge_contents`` handles both plain-string and block-list
        # content shapes (a single user turn with an attached image
        # produces block-list content; everything else is a string).
        merged: List[dict] = []
        for msg in cleaned:
            if merged and merged[-1]["role"] == msg["role"]:
                merged[-1]["content"] = self._merge_contents(
                    merged[-1]["content"], msg["content"]
                )
            else:
                merged.append(dict(msg))

        # Drop a trailing assistant message if for some reason history ends
        # there but we're about to append the user's new question; keep it
        # if the last entry is already user (will be merged below).
        # Then append the current question as a user message.
        if merged and merged[-1]["role"] == "user":
            merged[-1]["content"] = self._merge_contents(
                merged[-1]["content"], question
            )
        else:
            merged.append({"role": "user", "content": question})

        # The first message must be ``user``. If history somehow began with
        # an assistant turn, prepend a placeholder so Anthropic accepts it.
        if merged and merged[0]["role"] != "user":
            merged.insert(0, {"role": "user", "content": "(start of conversation)"})

        return merged, notice, dropped, through

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
        question,
        history: Optional[List[dict]] = None,
        system_prompt: Optional[str] = None,
        remaining_tokens: Optional[int] = None,
        model: Optional[dict] = None,
        prior_summary: Optional[str] = None,
        prior_summary_through: int = 0,
    ) -> AsyncGenerator[str, None]:
        """Stream a response from the AI model with token batching.

        Args:
            remaining_tokens: tokens left in the user's 5-hour bucket. When
                provided, max_tokens is scaled down so a single response can
                never push the user past the cap.
            model: optional model registry entry to use instead of the
                default. The caller is responsible for resolving/validating
                the client-supplied model key before passing it here.
            prior_summary: cached summary of earlier-conversation turns,
                if any. Used to keep long conversations coherent after
                older turns fall outside the active window.
            prior_summary_through: number of leading messages already
                represented by ``prior_summary`` — used to decide whether
                we need to extend the summary with newly-dropped turns.

        Yields SSE events: message_start, token, message_end, done.
        When the summary cache is refreshed inline, also yields an
        internal ``summary_update`` event with the new summary text so
        the caller can persist it.
        """
        model = model or CHAT_MODEL
        messages, truncation_notice, dropped, through = self._build_messages(
            question, history or []
        )

        # Truncation triggered: extend or build the conversation summary
        # so the model still sees a compact representation of what was
        # dropped. Failure here is non-fatal — we fall back to the plain
        # truncation notice below.
        active_summary: Optional[str] = prior_summary or None
        if dropped:
            # The cached summary already covers everything up to
            # ``prior_summary_through``. Anything past that index in the
            # dropped slice still needs to be incorporated.
            new_drop_start = max(0, prior_summary_through - 1)
            new_dropped_segment = dropped[new_drop_start:] if dropped else []
            if not active_summary or new_dropped_segment:
                refreshed = await self.client.summarize_conversation(
                    model_id=model["id"],
                    messages=new_dropped_segment or dropped,
                    previous_summary=active_summary,
                )
                if refreshed and refreshed != active_summary:
                    active_summary = refreshed
                    # Surface the new summary so the caller can persist it.
                    yield _sse_event(
                        "summary_update",
                        {"summary": refreshed, "through": through},
                    )

        # Truncation is communicated to the model via the system prompt
        # rather than via a synthetic message role (Anthropic only accepts
        # user/assistant in the messages array).
        if truncation_notice:
            extra = truncation_notice
            if active_summary:
                extra = (
                    f"{truncation_notice}\n\n"
                    f"Summary of the earlier conversation:\n{active_summary}"
                )
            system_prompt = (
                f"{system_prompt}\n\n{extra}" if system_prompt else extra
            )
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
                messages=messages,
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
