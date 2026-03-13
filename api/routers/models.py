from fastapi import APIRouter

from config import COUNCIL_MODELS, CHAIRMAN_MODEL
from schemas import AvailableModel, AvailableModelsResponse

router = APIRouter(tags=["models"])


@router.get("/models", response_model=AvailableModelsResponse)
async def get_models():
    """
    Get Available Models

    Returns the list of LLM models available for the council, including:

    - **models**: The panel of LLMs that can respond to questions and review each other
    - **chairman**: The LLM responsible for synthesizing the final answer

    Use this endpoint to get available models for selection when creating a session.
    """
    models = [
        AvailableModel(id=m["id"], name=m["name"], is_chairman=False)
        for m in COUNCIL_MODELS
    ]
    # Include chairman as a selectable model too
    models.append(
        AvailableModel(
            id=CHAIRMAN_MODEL["id"], name=CHAIRMAN_MODEL["name"], is_chairman=True
        )
    )

    chairman = AvailableModel(
        id=CHAIRMAN_MODEL["id"], name=CHAIRMAN_MODEL["name"], is_chairman=True
    )

    return AvailableModelsResponse(models=models, chairman=chairman)
