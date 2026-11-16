"""
Application settings loaded from environment variables.

All secrets and environment-specific values live here.
Never hardcode secrets; use .env in development and real env in production.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central config: env vars override defaults."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_env: Literal["development", "staging", "production"] = Field(
        default="development",
        description="Environment name for logging and behavior.",
        alias="ENV",
    )
    debug: bool = Field(default=False, description="Enable debug mode; do not use in production.")

    # Database: PostgreSQL primary, can override per environment
    database_url: str = Field(
        default="postgresql://lambda_user:strongpassword123@localhost:5432/lambda_db",
        description="SQLAlchemy database URL. Use a secure value from env in real deployments.",
    )

    # Auth (Phase 3): placeholders so config stays stable
    secret_key: str = Field(
        default="change-me-in-production",
        description="Secret for JWT signing. Must be set in production.",
    )
    google_client_id: str = Field(default="", description="Google OAuth client ID.")
    google_client_secret: str = Field(default="", description="Google OAuth client secret.")
    frontend_url: str = Field(
        default="http://localhost:5173",
        description="Frontend origin for CORS and redirects.",
    )
    admin_email: str = Field(
        default="madiyar.zmm@gmail.com",
        description="Email of the admin/owner account. Auto-assigned teacher role on first login.",
    )

    # Submissions: keep only for this many days; older ones are hidden and deleted on cleanup.
    # A classroom needs long-lived history (gradebooks, late review), so default to ~1 year.
    submission_retention_days: int = Field(
        default=365,
        ge=1,
        le=3650,
        description="Submissions older than this are excluded from lists and removed by cleanup.",
    )


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance. Use get_settings() in app; avoids re-reading env on every request."""
    return Settings()
