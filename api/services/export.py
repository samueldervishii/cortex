"""Service for exporting session data in various formats."""

import json
from datetime import datetime
from typing import List

from schemas import CouncilSession, CouncilMode


def format_as_json(sessions: List[CouncilSession]) -> str:
    """
    Format sessions as JSON.

    Returns a JSON string with all session data.
    """
    sessions_data = [session.model_dump() for session in sessions]
    export_data = {
        "export_date": datetime.utcnow().isoformat(),
        "session_count": len(sessions),
        "sessions": sessions_data,
    }
    return json.dumps(export_data, indent=2, ensure_ascii=False)


def format_as_markdown(sessions: List[CouncilSession]) -> str:
    """
    Format sessions as Markdown.

    Creates a readable Markdown document with all sessions and their content.
    """
    lines = [
        "# LLM Council - Chat Export",
        "",
        f"**Export Date:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC",
        f"**Total Sessions:** {len(sessions)}",
        "",
        "---",
        "",
    ]

    for idx, session in enumerate(sessions, 1):
        # Session header
        lines.append(f"## Session {idx}: {session.title or 'Untitled'}")
        lines.append("")
        lines.append(f"**Session ID:** `{session.id}`")

        if session.is_pinned:
            lines.append("**Status:** Pinned")
        if session.is_deleted:
            lines.append("**Status:** Deleted")

        lines.append(f"**Rounds:** {len(session.rounds)}")
        lines.append("")

        # Process each round
        for round_idx, round_data in enumerate(session.rounds, 1):
            lines.append(f"### Round {round_idx}")
            lines.append("")
            lines.append(f"**Question:** {round_data.question}")
            lines.append("")

            # Chat mode - show messages sequentially
            if round_data.mode == CouncilMode.CHAT and round_data.chat_messages:
                lines.append("**Chat Messages:**")
                lines.append("")

                for msg in round_data.chat_messages:
                    reply_to = (
                        f" *(replying to {msg.reply_to})*" if msg.reply_to else ""
                    )
                    lines.append(f"**{msg.model_name}**{reply_to}:")
                    lines.append("")
                    lines.append(msg.content)
                    lines.append("")

            # Formal mode - show responses, reviews, and synthesis
            elif round_data.mode == CouncilMode.FORMAL:
                # Council responses
                if round_data.responses:
                    lines.append("**Council Responses:**")
                    lines.append("")

                    for response in round_data.responses:
                        if response.error:
                            lines.append(
                                f"**{response.model_name}:** ❌ Error - {response.error}"
                            )
                        else:
                            lines.append(f"**{response.model_name}:**")
                            lines.append("")
                            lines.append(response.response)
                        lines.append("")

                # Peer reviews
                if round_data.peer_reviews:
                    lines.append("**Peer Reviews:**")
                    lines.append("")

                    for review in round_data.peer_reviews:
                        lines.append(f"**Reviewer: {review.reviewer_model}**")
                        lines.append("")
                        for rank in review.rankings:
                            model_name = rank.get("model_name", "Unknown")
                            score = rank.get("score", "N/A")
                            reasoning = rank.get("reasoning", "")
                            lines.append(
                                f"- **{model_name}** (Score: {score}): {reasoning}"
                            )
                        lines.append("")

                # Final synthesis
                if round_data.final_synthesis:
                    lines.append("**Chairman's Synthesis:**")
                    lines.append("")
                    lines.append(round_data.final_synthesis)
                    lines.append("")

                # Disagreement analysis
                if round_data.disagreement_analysis:
                    lines.append("**Disagreement Analysis:**")
                    lines.append("")
                    for analysis in round_data.disagreement_analysis:
                        if analysis.get("has_disagreement"):
                            model = analysis.get("model_name", "Unknown")
                            score = analysis.get("disagreement_score", 0)
                            lines.append(
                                f"- **{model}**: Disagreement Score: {score:.2f}"
                            )
                    lines.append("")

            lines.append("---")
            lines.append("")

    lines.append("")
    lines.append("*Generated by LLM Council*")

    return "\n".join(lines)
