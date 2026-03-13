import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from core.dependencies import get_folder_repository, get_session_repository
from db.folder_repository import FolderRepository
from db.session_repository import SessionRepository
from schemas import (
    Folder,
    FolderCreateRequest,
    FolderUpdateRequest,
    FolderResponse,
    FolderListResponse,
    MoveSessionRequest,
)

router = APIRouter(tags=["folders"])


@router.get("/folders", response_model=FolderListResponse)
async def list_folders(
    folder_repo: FolderRepository = Depends(get_folder_repository),
):
    """List all folders ordered by position."""
    folders = await folder_repo.list_all()
    return FolderListResponse(folders=folders, count=len(folders))


@router.post(
    "/folders", response_model=FolderResponse, status_code=status.HTTP_201_CREATED
)
async def create_folder(
    request: FolderCreateRequest,
    folder_repo: FolderRepository = Depends(get_folder_repository),
):
    """Create a new folder."""
    next_position = await folder_repo.get_next_position()

    folder = Folder(
        id=str(uuid.uuid4()),
        name=request.name,
        color=request.color,
        icon=request.icon,
        position=next_position,
    )

    await folder_repo.create(folder)
    return FolderResponse(folder=folder, message="Folder created successfully")


@router.get("/folders/{folder_id}", response_model=FolderResponse)
async def get_folder(
    folder_id: str,
    folder_repo: FolderRepository = Depends(get_folder_repository),
):
    """Get a folder by ID."""
    folder = await folder_repo.get(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return FolderResponse(folder=folder, message="Folder retrieved successfully")


@router.patch("/folders/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: str,
    request: FolderUpdateRequest,
    folder_repo: FolderRepository = Depends(get_folder_repository),
):
    """Update a folder."""
    folder = await folder_repo.get(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    # Update only provided fields
    if request.name is not None:
        folder.name = request.name
    if request.color is not None:
        folder.color = request.color
    if request.icon is not None:
        folder.icon = request.icon
    if request.position is not None:
        folder.position = request.position
    if request.is_collapsed is not None:
        folder.is_collapsed = request.is_collapsed

    await folder_repo.update(folder)
    return FolderResponse(folder=folder, message="Folder updated successfully")


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    folder_repo: FolderRepository = Depends(get_folder_repository),
    session_repo: SessionRepository = Depends(get_session_repository),
):
    """Delete a folder. Sessions in the folder will be moved to 'no folder'."""
    folder = await folder_repo.get(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    # Remove folder_id from all sessions in this folder
    # We need to update all sessions that have this folder_id
    sessions = await session_repo.list_all(limit=1000)
    for session in sessions:
        if session.get("folder_id") == folder_id:
            await session_repo.update_folder(session["id"], None)

    await folder_repo.delete(folder_id)
    return {"message": "Folder deleted successfully"}


@router.post("/folders/reorder")
async def reorder_folders(
    folder_ids: list[str],
    folder_repo: FolderRepository = Depends(get_folder_repository),
):
    """Reorder folders based on the provided list of IDs."""
    await folder_repo.reorder(folder_ids)
    return {"message": "Folders reordered successfully"}


@router.patch("/session/{session_id}/folder", response_model=dict)
async def move_session_to_folder(
    session_id: str,
    request: MoveSessionRequest,
    session_repo: SessionRepository = Depends(get_session_repository),
    folder_repo: FolderRepository = Depends(get_folder_repository),
):
    """Move a session to a folder (or remove from folder if folder_id is null)."""
    # Verify session exists
    session = await session_repo.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # If folder_id is provided, verify folder exists
    if request.folder_id is not None:
        folder = await folder_repo.get(request.folder_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")

    # Update session's folder_id
    success = await session_repo.update_folder(session_id, request.folder_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update session folder")

    return {"message": "Session moved successfully", "folder_id": request.folder_id}
