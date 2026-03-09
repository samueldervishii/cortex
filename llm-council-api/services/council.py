import asyncio
import json
import time
from statistics import mean, stdev, StatisticsError
from typing import List, Optional, Dict

from clients import LLMClient
from config import COUNCIL_MODELS, CHAIRMAN_MODEL
from core.logging import logger
from schemas import ModelResponse, PeerReview, ConversationRound, ChatMessage
from .prompts import Prompts


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
    variants = [name]
    # Strip version numbers like "4.6", "4.5", "120B", "20B", "32B"
    import re
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

    async def get_council_responses(
        self,
        current_round: ConversationRound,
        previous_rounds: Optional[List[ConversationRound]] = None,
    ) -> List[ModelResponse]:
        """Query all council models in parallel."""
        has_context = previous_rounds and len(previous_rounds) > 0
        system_prompt = (
            Prompts.COUNCIL_MEMBER_SYSTEM_WITH_CONTEXT
            if has_context
            else Prompts.COUNCIL_MEMBER_SYSTEM
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

        logger.info(f"Starting synthesis with {CHAIRMAN_MODEL['name']}")
        logger.info(f"Synthesis prompt length: {len(synthesis_prompt)} chars")

        final_response = await self._call_model(
            CHAIRMAN_MODEL,
            synthesis_prompt,
            system_prompt=Prompts.CHAIRMAN_SYSTEM,
            max_tokens=4096,
        )

        logger.info(f"Synthesis complete, response length: {len(final_response)} chars")
        return final_response

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
                other_models = [
                    m["name"] for m in all_chat_models if m["id"] != target["id"]
                ]
                system_prompt = Prompts.get_chat_system_prompt(
                    target["name"], other_models, is_first=False
                )
                user_prompt = Prompts.build_chat_prompt(
                    question=current_round.question,
                    chat_messages=chat_messages,
                    previous_rounds=previous_rounds,
                )

                try:
                    start_time = time.monotonic()
                    response = await self._call_model(
                        target,
                        user_prompt,
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

                    message = ChatMessage(
                        model_id=target["id"],
                        model_name=target["name"],
                        content=response,
                        reply_to=reply_to,
                        response_time_ms=elapsed_ms,
                    )
                    return [message]  # Only return the single targeted response

                except Exception as e:
                    logger.error(f"Error from {target['name']}: {e}")
                    return [ChatMessage(
                        model_id=target["id"],
                        model_name=target["name"],
                        content=f"[Failed to respond: {str(e)}]",
                        reply_to=None,
                        response_time_ms=None,
                    )]

        logger.info(
            f"Starting debate with {len(all_chat_models)} models, {num_turns} turns each"
        )

        for turn in range(num_turns):
            logger.info(f"=== Turn {turn + 1}/{num_turns} ===")

            for model in all_chat_models:
                other_models = [
                    m["name"] for m in all_chat_models if m["id"] != model["id"]
                ]

                # Same prompt for everyone — no special chairman role in chat
                is_first = len(chat_messages) == 0
                system_prompt = Prompts.get_chat_system_prompt(
                    model["name"], other_models, is_first=is_first
                )

                # Build user prompt with chat history
                user_prompt = Prompts.build_chat_prompt(
                    question=current_round.question,
                    chat_messages=chat_messages,
                    previous_rounds=previous_rounds,
                )

                try:
                    logger.info(f"Querying {model['name']}...")
                    start_time = time.monotonic()
                    response = await self._call_model(
                        model,
                        user_prompt,
                        system_prompt=system_prompt,
                        max_tokens=512,
                        temperature=0.8,
                    )
                    elapsed_ms = int((time.monotonic() - start_time) * 1000)

                    # Detect if replying to someone (model or user)
                    reply_to = None
                    if "@User" in response:
                        reply_to = "User"
                    else:
                        for other_name in other_models:
                            if _detect_mention(response, other_name):
                                reply_to = other_name
                                break

                    message = ChatMessage(
                        model_id=model["id"],
                        model_name=model["name"],
                        content=response,
                        reply_to=reply_to,
                        response_time_ms=elapsed_ms,
                    )
                    chat_messages.append(message)
                    logger.info(f"{model['name']}: {response[:100]}...")

                except Exception as e:
                    logger.error(f"Error from {model['name']}: {e}")
                    message = ChatMessage(
                        model_id=model["id"],
                        model_name=model["name"],
                        content=f"[Failed to respond: {str(e)}]",
                        reply_to=None,
                        response_time_ms=None,
                    )
                    chat_messages.append(message)

        # Mention-triggered follow-ups: if a model was @mentioned, it gets to respond
        mentioned_models = self._find_mentioned_models(chat_messages, all_chat_models)
        if mentioned_models:
            logger.info(f"Mention follow-ups for: {[m['name'] for m in mentioned_models]}")

            for model in mentioned_models:
                other_models = [
                    m["name"] for m in all_chat_models if m["id"] != model["id"]
                ]
                system_prompt = Prompts.get_chat_system_prompt(
                    model["name"], other_models, is_first=False
                )
                user_prompt = Prompts.build_chat_prompt(
                    question=current_round.question,
                    chat_messages=chat_messages,
                    previous_rounds=previous_rounds,
                )

                try:
                    logger.info(f"Mention follow-up: {model['name']}...")
                    start_time = time.monotonic()
                    response = await self._call_model(
                        model,
                        user_prompt,
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

                    message = ChatMessage(
                        model_id=model["id"],
                        model_name=model["name"],
                        content=response,
                        reply_to=reply_to,
                        response_time_ms=elapsed_ms,
                    )
                    chat_messages.append(message)
                except Exception as e:
                    logger.error(f"Mention follow-up error from {model['name']}: {e}")

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
