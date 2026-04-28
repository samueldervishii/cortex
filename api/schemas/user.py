from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserInDB(BaseModel):
    id: str
    email: str
    hashed_password: str
    display_name: str = ""
    username: str = ""
    avatar: str = ""
    field_of_work: str = ""
    personal_preferences: str = ""
    created_at: datetime


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str = ""
    username: str = ""
    avatar: str = ""
    field_of_work: str = ""
    personal_preferences: str = ""
    created_at: str


class ProfileUpdate(BaseModel):
    display_name: str = Field("", max_length=100)
    username: str = Field("", max_length=50, pattern=r"^[a-zA-Z0-9_]*$")
    field_of_work: str = Field("", max_length=100)
    personal_preferences: str = Field("", max_length=2000)

    def model_post_init(self, __context):
        if self.username and len(self.username) < 3:
            raise ValueError("Username must be at least 3 characters")


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


class DeleteAccount(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=256)
    new_password: str = Field(..., min_length=8, max_length=128)
