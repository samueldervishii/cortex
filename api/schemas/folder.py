from typing import Optional, List
from pydantic import BaseModel, Field


class Folder(BaseModel):
    """A folder for organizing sessions."""

    id: str = Field(..., description="Unique folder identifier (UUID)")
    name: str = Field(..., description="Folder name", min_length=1, max_length=100)
    color: Optional[str] = Field(
        None, description="Optional color for the folder (hex code)"
    )
    icon: Optional[str] = Field(None, description="Optional icon name for the folder")
    position: int = Field(
        default=0, description="Position for ordering folders (lower = higher)"
    )
    is_collapsed: bool = Field(
        default=False, description="Whether the folder is collapsed in the UI"
    )


class FolderCreateRequest(BaseModel):
    """Request to create a new folder."""

    name: str = Field(..., description="Folder name", min_length=1, max_length=100)
    color: Optional[str] = Field(None, description="Optional hex color code")
    icon: Optional[str] = Field(None, description="Optional icon name")


class FolderUpdateRequest(BaseModel):
    """Request to update a folder."""

    name: Optional[str] = Field(
        None, description="New folder name", min_length=1, max_length=100
    )
    color: Optional[str] = Field(None, description="New color (hex code)")
    icon: Optional[str] = Field(None, description="New icon name")
    position: Optional[int] = Field(None, description="New position")
    is_collapsed: Optional[bool] = Field(None, description="Collapsed state")


class FolderResponse(BaseModel):
    """Response containing folder data."""

    folder: Folder = Field(..., description="The folder object")
    message: str = Field(..., description="Status message")


class FolderListResponse(BaseModel):
    """Response containing list of folders."""

    folders: List[Folder] = Field(..., description="List of folders")
    count: int = Field(..., description="Total number of folders")


class MoveSessionRequest(BaseModel):
    """Request to move a session to a folder."""

    folder_id: Optional[str] = Field(
        None, description="Folder ID to move to (null to remove from folder)"
    )
