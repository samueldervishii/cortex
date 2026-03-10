import asyncio
import json
import time
from statistics import mean, stdev, StatisticsError
from typing import AsyncGenerator, List, Optional, Dict

from clients import LLMClient
from config import COUNCIL_MODELS, CHAIRMAN_MODEL
from core.logging import logger
from schemas import ModelResponse, PeerReview, ConversationRound, ChatMessage
from .prompts import Prompts


def _sse_event(event: str, data: dict) -> str:
    """Format a server-sent event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def analyze_disagreement(
    responses: List[ModelResponse], peer_reviews: List[PeerReview]
) -> List[Dict]:
    """
    Analyze disagreement among council members based on peer reviews.

    Returns a list of disagreement analysis for each response, containing:
    - model_id: The model whose response was analyzed
    - model_name: Human-readable model name
    - ranks_received: All ranks given by reviewers
    - mean_rank: Average rank
    - disagreement_score: 0 (consensus) to 1 (high disagreement)
    - has_disagreement: Whether significant disagreement exists
    """
    if not peer_reviews or not responses:
        return []

    valid_responses = [r for r in responses if not r.error]
    if len(valid_responses) < 2:
        return []

    # Map response index (1-based) to model info
    response_map = {
        i + 1: {"model_id": r.model_id, "model_name": r.model_name}
        for i, r in enumerate(valid_responses)
    }

    # Collect ranks for each response
    ranks_by_response: Dict[int, List[int]] = {i: [] for i in response_map.keys()}

    for review in peer_reviews:
        for ranking in review.rankings:
            if (
                isinstance(ranking, dict)
                and "response_num" in ranking
                and "rank" in ranking
            ):
                resp_num = ranking.get("response_num")
                rank = ranking.get("rank")
                if resp_num in ranks_by_response and isinstance(rank, (int, float)):
                    ranks_by_response[resp_num].append(int(rank))

    # Calculate disagreement for each response
    analysis = []
    num_responses = len(valid_responses)

    for resp_num, ranks in ranks_by_response.items():
        model_info = response_map.get(resp_num, {})

        if len(ranks) < 2:
            analysis.append(
                {
                    "model_id": model_info.get("model_id", ""),
                    "model_name": model_info.get("model_name", ""),
                    "ranks_received": ranks,
                    "mean_rank": ranks[0] if ranks else 0,
                    "disagreement_score": 0.0,
                    "has_disagreement": False,
                }
            )
            continue

        avg_rank = mean(ranks)

        try:
            std = stdev(ranks)
        except StatisticsError:
            std = 0.0

        max_std = (num_responses - 1) / 2
        disagreement_score = min(std / max_std, 1.0) if max_std > 0 else 0.0

        rank_range = max(ranks) - min(ranks) if ranks else 0
        has_disagreement = disagreement_score > 0.5 or rank_range >= num_responses / 2

        analysis.append(
            {
                "model_id": model_info.get("model_id", ""),
                "model_name": model_info.get("model_name", ""),
                "ranks_received": ranks,
                "mean_rank": round(avg_rank, 2),
                "disagreement_score": round(disagreement_score, 2),
                "has_disagreement": has_disagreement,
            }
        )

    return analysis


def _get_name_variants(name: str) -> List[str]:
    """Get name variants for mention matching (e.g., 'Claude Sonnet 4.6' -> ['Claude Sonnet 4.6', 'Claude Sonnet'])."""
    import re

    variants = [name]
    # Strip version numbers like "4.6", "4.5", "120B", "20B", "32B"
    short = re.sub(r"\s+\d+(\.\d+)?[A-Z]?$", "", name).strip()
    if short and short != name:
        variants.append(short)
    return variants


def _detect_mention(response: str, model_name: str) -> bool:
    """Check if a response mentions a model by full or short name."""
    for variant in _get_name_variants(model_name):
        if f"@{variant}" in response:
            return True
    return False


class CouncilService:
    """Service for managing LLM Council debate operations."""

    def __init__(self, client: LLMClient):
        self.client = client

    def _get_active_models(
        self,
        selected_models: Optional[List[str]] = None,
        include_chairman: bool = False,
    ) -> List[dict]:
        """
        Get the models to use based on selection.

        In chat/debate mode, the chairman (Sonnet 4.6) goes FIRST to lead the discussion.
        """
        if selected_models is None:
            if include_chairman:
                # Chairman leads - put first
                return [CHAIRMAN_MODEL] + COUNCIL_MODELS
            return COUNCIL_MODELS

        if include_chairman:
            all_models = [CHAIRMAN_MODEL] + COUNCIL_MODELS
        else:
            all_models = COUNCIL_MODELS

        return [m for m in all_models if m["id"] in selected_models]

    def _build_system_prompt(
        self,
        base_prompt: str,
        custom_prompt: Optional[str] = None,
        persona: Optional[str] = None,
    ) -> str:
        """Build system prompt with optional custom instructions and model persona."""
        prompt = base_prompt
        if persona and persona.strip():
            prompt = f"{prompt}\n\nYour persona: {persona.strip()}"
        return Prompts.with_custom_instructions(prompt, custom_prompt)

    async def _call_model(
        self,
        model: dict,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> str:
        """Call a model through the appropriate provider."""
        return await self.client.chat(
            model_id=model["id"],
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            provider=model["provider"],
        )

    def _stream_model(
        self,
        model: dict,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from a model through the appropriate provider."""
        return self.client.stream_chat(
            model_id=model["id"],
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            provider=model["provider"],
        )

    async def get_council_responses(
        self,
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]] = None,
    ) -> List[ModelResponse]:
        """Query all council models in parallel."""
        has_context = previous_rounds and len(previous_rounds) > 0
        base_prompt = (
            Prompts.COUNCIL_MEMBER_SYSTEM_WITH_CONTEXT
            if has_context
            else Prompts.COUNCIL_MEMBER_SYSTEM
        )
        system_prompt = self._build_system_prompt(
            base_prompt, current_round.system_prompt
        )

        prompt = Prompts.build_question_with_context(
            question=current_round.question, previous_rounds=previous_rounds
        )

        async def query_model(model: dict) -> ModelResponse:
            try:
                start_time = time.monotonic()
                response = await self._call_model(
                    model, prompt, system_prompt=system_prompt
                )
                elapsed_ms = int((time.monotonic() - start_time) * 1000)
                return ModelResponse(
                    model_id=model["id"],
                    model_name=model["name"],
                    response=response,
                    error=None,
                    response_time_ms=elapsed_ms,
                )
            except Exception as e:
                return ModelResponse(
                    model_id=model["id"],
                    model_name=model["name"],
                    response="",
                    error=str(e),
                    response_time_ms=None,
                )

        active_models = self._get_active_models(
            current_round.selected_models, include_chairman=False
        )
        tasks = [query_model(model) for model in active_models]
        responses = await asyncio.gather(*tasks)
        return list(responses)

    async def get_peer_reviews(
        self,
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]] = None,
    ) -> List[PeerReview]:
        """Have each council member review and rank the others' responses."""
        valid_responses = [r for r in current_round.responses if not r.error]

        if len(valid_responses) < 2:
            return []

        async def get_review(model: dict) -> PeerReview:
            try:
                prompt = Prompts.build_review_prompt(
                    question=current_round.question,
                    valid_responses=valid_responses,
                    reviewer_id=model["id"],
                    previous_rounds=previous_rounds,
                )

                response = await self._call_model(
                    model, prompt, temperature=0.3
                )

                try:
                    start = response.find("[")
                    end = response.rfind("]") + 1
                    if start != -1 and end > start:
                        rankings = json.loads(response[start:end])
                    else:
                        rankings = []
                except json.JSONDecodeError:
                    rankings = [{"raw_response": response}]

                return PeerReview(reviewer_model=model["name"], rankings=rankings)
            except Exception as e:
                return PeerReview(
                    reviewer_model=model["name"], rankings=[{"error": str(e)}]
                )

        active_models = self._get_active_models(
            current_round.selected_models, include_chairman=False
        )
        tasks = [get_review(model) for model in active_models]
        reviews = await asyncio.gather(*tasks)
        return list(reviews)

    async def synthesize_response(
        self,
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]] = None,
    ) -> str:
        """Have the chairman synthesize a final response."""
        valid_responses = [r for r in current_round.responses if not r.error]

        reviews_text = ""
        for review in current_round.peer_reviews:
            reviews_text += f"\n\n--- Review by {review.reviewer_model} ---\n{json.dumps(review.rankings, indent=2)}"

        synthesis_prompt = Prompts.build_synthesis_prompt(
            question=current_round.question,
            valid_responses=valid_responses,
            reviews_text=reviews_text,
            previous_rounds=previous_rounds,
        )

        chairman_system = self._build_system_prompt(
            Prompts.CHAIRMAN_SYSTEM, current_round.system_prompt
        )

        logger.info(f"Starting synthesis with {CHAIRMAN_MODEL['name']}")
        logger.info(f"Synthesis prompt length: {len(synthesis_prompt)} chars")

        final_response = await self._call_model(
            CHAIRMAN_MODEL,
            synthesis_prompt,
            system_prompt=chairman_system,
            max_tokens=4096,
        )

        logger.info(f"Synthesis complete, response length: {len(final_response)} chars")
        return final_response

    # ==================== STREAMING METHODS ====================

    async def stream_formal_council(
        self,
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]] = None,
        personas: Optional[Dict[str, str]] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream the full formal council process as SSE events with token-level streaming."""
        yield _sse_event("step", {"step": "responses", "message": "Gathering council responses..."})

        has_context = previous_rounds and len(previous_rounds) > 0
        base_prompt = (
            Prompts.COUNCIL_MEMBER_SYSTEM_WITH_CONTEXT
            if has_context
            else Prompts.COUNCIL_MEMBER_SYSTEM
        )
        personas = personas or {}
        prompt = Prompts.build_question_with_context(
            question=current_round.question, previous_rounds=previous_rounds
        )

        active_models = self._get_active_models(
            current_round.selected_models, include_chairman=False
        )

        # Queue for interleaving token events from parallel models
        queue: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()

        async def stream_model_to_queue(model: dict):
            """Stream a single model's tokens into the shared queue."""
            model_id = model["id"]
            model_name = model["name"]
            model_persona = personas.get(model_id)
            model_system = self._build_system_prompt(
                base_prompt, current_round.system_prompt, persona=model_persona
            )
            try:
                start_time = time.monotonic()
                await queue.put(("start", model_id, model_name, None))
                full_text = []
                async for token in self._stream_model(
                    model, prompt, system_prompt=model_system
                ):
                    full_text.append(token)
                    await queue.put(("token", model_id, model_name, token))
                elapsed_ms = int((time.monotonic() - start_time) * 1000)
                response_text = "".join(full_text)
                await queue.put(("end", model_id, model_name, {
                    "response": response_text,
                    "response_time_ms": elapsed_ms,
                }))
            except Exception as e:
                await queue.put(("error", model_id, model_name, str(e)))

        tasks = [asyncio.create_task(stream_model_to_queue(m)) for m in active_models]

        # Also push a sentinel when all tasks are done
        async def push_sentinel():
            await asyncio.gather(*tasks, return_exceptions=True)
            await queue.put(SENTINEL)

        sentinel_task = asyncio.create_task(push_sentinel())

        responses = []
        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            event_type, model_id, model_name, payload = item

            if event_type == "start":
                yield _sse_event("response_start", {
                    "model_id": model_id,
                    "model_name": model_name,
                })
            elif event_type == "token":
                yield _sse_event("response_token", {
                    "model_id": model_id,
                    "token": payload,
                })
            elif event_type == "end":
                responses.append(ModelResponse(
                    model_id=model_id,
                    model_name=model_name,
                    response=payload["response"],
                    error=None,
                    response_time_ms=payload["response_time_ms"],
                ))
                yield _sse_event("response_end", {
                    "model_id": model_id,
                    "model_name": model_name,
                    "response_time_ms": payload["response_time_ms"],
                })
            elif event_type == "error":
                responses.append(ModelResponse(
                    model_id=model_id,
                    model_name=model_name,
                    response="",
                    error=payload,
                    response_time_ms=None,
                ))
                yield _sse_event("error_response", {
                    "model_id": model_id,
                    "model_name": model_name,
                    "error": payload,
                })

        await sentinel_task

        current_round.responses = responses
        current_round.status = "responses_complete"

        # Step 2: Peer reviews (not token-streamed — they're fast)
        yield _sse_event("step", {"step": "reviews", "message": "Council members are reviewing..."})

        reviews = await self.get_peer_reviews(current_round, previous_rounds)
        current_round.peer_reviews = reviews
        current_round.status = "reviews_complete"
        current_round.disagreement_analysis = analyze_disagreement(responses, reviews)

        # Step 3: Synthesis — stream tokens for chairman too
        yield _sse_event("step", {"step": "synthesis", "message": "Council Head is deciding..."})

        valid_responses = [r for r in current_round.responses if not r.error]
        reviews_text = ""
        for review in current_round.peer_reviews:
            reviews_text += f"\n\n--- Review by {review.reviewer_model} ---\n{json.dumps(review.rankings, indent=2)}"

        synthesis_prompt = Prompts.build_synthesis_prompt(
            question=current_round.question,
            valid_responses=valid_responses,
            reviews_text=reviews_text,
            previous_rounds=previous_rounds,
        )
        chairman_persona = personas.get(CHAIRMAN_MODEL["id"])
        chairman_system = self._build_system_prompt(
            Prompts.CHAIRMAN_SYSTEM, current_round.system_prompt, persona=chairman_persona
        )

        yield _sse_event("synthesis_start", {"model_name": CHAIRMAN_MODEL["name"]})
        synthesis_parts = []
        async for token in self._stream_model(
            CHAIRMAN_MODEL,
            synthesis_prompt,
            system_prompt=chairman_system,
            max_tokens=4096,
        ):
            synthesis_parts.append(token)
            yield _sse_event("synthesis_token", {"token": token})

        synthesis = "".join(synthesis_parts)
        current_round.final_synthesis = synthesis
        current_round.status = "synthesized"

        yield _sse_event("synthesis_end", {})
        yield _sse_event("done", {})

    async def _stream_chat_single_model(
        self,
        model: dict,
        all_models: List[dict],
        chat_messages: List[ChatMessage],
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]],
        custom_prompt: Optional[str] = None,
        persona: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream a single chat model's response as SSE events, yielding tokens."""
        other_models = [m["name"] for m in all_models if m["id"] != model["id"]]
        is_first = len(chat_messages) == 0
        base_system = Prompts.get_chat_system_prompt(
            model["name"], other_models, is_first=is_first
        )
        system_prompt = self._build_system_prompt(base_system, custom_prompt, persona=persona)

        user_prompt = Prompts.build_chat_prompt(
            question=current_round.question,
            chat_messages=chat_messages,
            previous_rounds=previous_rounds,
        )

        yield _sse_event("chat_message_start", {
            "model_id": model["id"],
            "model_name": model["name"],
        })

        try:
            start_time = time.monotonic()
            full_text = []
            async for token in self._stream_model(
                model, user_prompt,
                system_prompt=system_prompt,
                max_tokens=512,
                temperature=0.8,
            ):
                full_text.append(token)
                yield _sse_event("chat_message_token", {
                    "model_id": model["id"],
                    "token": token,
                })
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            response = "".join(full_text)

            reply_to = None
            if "@User" in response:
                reply_to = "User"
            else:
                for other_name in other_models:
                    if _detect_mention(response, other_name):
                        reply_to = other_name
                        break

            msg = ChatMessage(
                model_id=model["id"],
                model_name=model["name"],
                content=response,
                reply_to=reply_to,
                response_time_ms=elapsed_ms,
            )
            chat_messages.append(msg)

            yield _sse_event("chat_message_end", {
                "model_id": model["id"],
                "model_name": model["name"],
                "content": response,
                "reply_to": reply_to,
                "response_time_ms": elapsed_ms,
            })

        except Exception as e:
            logger.error(f"Error from {model['name']}: {e}")
            error_content = f"[Failed to respond: {str(e)}]"
            msg = ChatMessage(
                model_id=model["id"],
                model_name=model["name"],
                content=error_content,
                reply_to=None,
                response_time_ms=None,
            )
            chat_messages.append(msg)
            yield _sse_event("chat_message_end", {
                "model_id": model["id"],
                "model_name": model["name"],
                "content": error_content,
                "reply_to": None,
                "response_time_ms": None,
            })

    async def stream_group_chat(
        self,
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]] = None,
        target_model: Optional[str] = None,
        personas: Optional[Dict[str, str]] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream group chat messages as SSE events with token-level streaming."""
        chat_messages: List[ChatMessage] = (
            list(current_round.chat_messages) if target_model else []
        )

        all_chat_models = self._get_active_models(
            current_round.selected_models, include_chairman=True
        )

        custom_prompt = current_round.system_prompt
        personas = personas or {}

        # If targeting a specific model, only that one responds
        if target_model:
            target = None
            for m in all_chat_models:
                if m["name"] == target_model:
                    target = m
                    break
            if target:
                async for event in self._stream_chat_single_model(
                    target, all_chat_models, chat_messages,
                    current_round, previous_rounds, custom_prompt,
                    persona=personas.get(target["id"]),
                ):
                    yield event
                if target_model and current_round.chat_messages:
                    current_round.chat_messages = current_round.chat_messages + chat_messages[-1:]
                else:
                    current_round.chat_messages = chat_messages
                current_round.status = "chat_complete"
                yield _sse_event("done", {})
                return

        # Full group chat: each model responds sequentially with token streaming
        for model in all_chat_models:
            async for event in self._stream_chat_single_model(
                model, all_chat_models, chat_messages,
                current_round, previous_rounds, custom_prompt,
                persona=personas.get(model["id"]),
            ):
                yield event

        # Mention follow-ups
        mentioned_models = self._find_mentioned_models(chat_messages, all_chat_models)
        for model in mentioned_models:
            async for event in self._stream_chat_single_model(
                model, all_chat_models, chat_messages,
                current_round, previous_rounds, custom_prompt,
                persona=personas.get(model["id"]),
            ):
                yield event

        current_round.chat_messages = chat_messages
        current_round.status = "chat_complete"
        yield _sse_event("done", {})

    async def _chat_single_model(
        self,
        model: dict,
        all_models: List[dict],
        chat_messages: List[ChatMessage],
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]],
        custom_prompt: Optional[str] = None,
    ) -> ChatMessage:
        """Query a single model in chat mode and return a ChatMessage."""
        other_models = [m["name"] for m in all_models if m["id"] != model["id"]]
        is_first = len(chat_messages) == 0
        base_system = Prompts.get_chat_system_prompt(
            model["name"], other_models, is_first=is_first
        )
        system_prompt = self._build_system_prompt(base_system, custom_prompt)

        user_prompt = Prompts.build_chat_prompt(
            question=current_round.question,
            chat_messages=chat_messages,
            previous_rounds=previous_rounds,
        )

        try:
            start_time = time.monotonic()
            response = await self._call_model(
                model, user_prompt,
                system_prompt=system_prompt,
                max_tokens=512,
                temperature=0.8,
            )
            elapsed_ms = int((time.monotonic() - start_time) * 1000)

            reply_to = None
            if "@User" in response:
                reply_to = "User"
            else:
                for other_name in other_models:
                    if _detect_mention(response, other_name):
                        reply_to = other_name
                        break

            return ChatMessage(
                model_id=model["id"],
                model_name=model["name"],
                content=response,
                reply_to=reply_to,
                response_time_ms=elapsed_ms,
            )
        except Exception as e:
            logger.error(f"Error from {model['name']}: {e}")
            return ChatMessage(
                model_id=model["id"],
                model_name=model["name"],
                content=f"[Failed to respond: {str(e)}]",
                reply_to=None,
                response_time_ms=None,
            )

    # ==================== NON-STREAMING GROUP CHAT ====================

    async def run_group_chat(
        self,
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]] = None,
        num_turns: int = 1,
        target_model: Optional[str] = None,
    ) -> List[ChatMessage]:
        """
        Run a debate-style discussion where models respond sequentially,
        each seeing and building on what previous models said.

        If target_model is set (model name), only that model responds.
        This is used for @mention targeting — like WhatsApp, when you
        @mention someone, only they reply.
        """
        # Include existing chat messages as context for targeted responses
        chat_messages: List[ChatMessage] = list(current_round.chat_messages) if target_model else []
        custom_prompt = current_round.system_prompt

        # Chairman leads - included first in chat mode
        all_chat_models = self._get_active_models(
            current_round.selected_models, include_chairman=True
        )

        # If targeting a specific model, only query that one
        if target_model:
            target = None
            for m in all_chat_models:
                if m["name"] == target_model:
                    target = m
                    break
            if not target:
                logger.warning(f"Target model '{target_model}' not found, falling back to all")
            else:
                logger.info(f"Targeted response from {target_model}")
                msg = await self._chat_single_model(
                    target, all_chat_models, chat_messages,
                    current_round, previous_rounds, custom_prompt,
                )
                return [msg]

        logger.info(
            f"Starting debate with {len(all_chat_models)} models, {num_turns} turns each"
        )

        for turn in range(num_turns):
            logger.info(f"=== Turn {turn + 1}/{num_turns} ===")

            for model in all_chat_models:
                msg = await self._chat_single_model(
                    model, all_chat_models, chat_messages,
                    current_round, previous_rounds, custom_prompt,
                )
                chat_messages.append(msg)
                logger.info(f"{model['name']}: {msg.content[:100]}...")

        # Mention-triggered follow-ups: if a model was @mentioned, it gets to respond
        mentioned_models = self._find_mentioned_models(chat_messages, all_chat_models)
        if mentioned_models:
            logger.info(f"Mention follow-ups for: {[m['name'] for m in mentioned_models]}")

            for model in mentioned_models:
                msg = await self._chat_single_model(
                    model, all_chat_models, chat_messages,
                    current_round, previous_rounds, custom_prompt,
                )
                chat_messages.append(msg)

        logger.info(f"Debate complete with {len(chat_messages)} messages")
        return chat_messages

    def _find_mentioned_models(
        self,
        chat_messages: List[ChatMessage],
        all_models: List[dict],
    ) -> List[dict]:
        """Find models that were @mentioned in the last round but haven't replied after being mentioned."""
        if not chat_messages:
            return []

        # Build a map of model names to model dicts
        model_map = {m["name"]: m for m in all_models}

        # Track who was mentioned and by whom, only from recent messages
        mentioned = set()
        # Who already spoke (as the last speaker)
        last_speaker = chat_messages[-1].model_name if chat_messages else None

        for msg in chat_messages:
            for name in model_map:
                if name == msg.model_name:
                    continue
                if _detect_mention(msg.content, name):
                    mentioned.add(name)

        # Remove models who already spoke AFTER being mentioned
        # (check if their last message is after the last mention)
        responded_after_mention = set()
        for name in mentioned:
            last_mention_idx = -1
            last_response_idx = -1
            for i, msg in enumerate(chat_messages):
                if _detect_mention(msg.content, name) and msg.model_name != name:
                    last_mention_idx = i
                if msg.model_name == name:
                    last_response_idx = i
            if last_response_idx > last_mention_idx:
                responded_after_mention.add(name)

        needs_followup = mentioned - responded_after_mention
        return [model_map[name] for name in needs_followup if name in model_map]
