"""
Application-level dependency injection.

Used by FastAPI Depends() to provide DB session, config, and (later) current user.
Keeps route handlers thin and testable.
"""

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User

logger = logging.getLogger(__name__)

# Type aliases for cleaner route signatures
SettingsDep = Annotated[Settings, Depends(get_settings)]
DBSession = Annotated[Session, Depends(get_db)]

# Cookie name used by the OAuth callback and dev-login to store the JWT.
# httpOnly cookies are the primary auth mechanism; Bearer tokens stay
# supported for backwards compatibility and for non-browser clients.
AUTH_COOKIE_NAME = "lambda_token"


def _extract_token(request: Request) -> str | None:
    """Return the JWT from cookie first, then Authorization: Bearer header.

    Cookie-first means the browser path is the trusted default; the Bearer
    fallback keeps dev tooling, WebSocket query-param auth, and tests working
    during the migration off localStorage.
    """
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if token:
        return token
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip() or None
    return None


def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the current authenticated user from a JWT.

    Token source order: ``lambda_token`` httpOnly cookie, then
    ``Authorization: Bearer ...`` header. Raises HTTP 401 if neither
    yields a valid token or the user does not exist.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token = _extract_token(request)
    if not token:
        raise credentials_exception

    try:
        payload = decode_access_token(token, settings=settings)
        user_id: str | None = payload.get("sub")  # type: ignore[assignment]
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected error decoding token: %s", exc)
        raise credentials_exception

    user = db.get(User, user_id)
    if user is None:
        raise credentials_exception
    if user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been suspended.",
        )
    user.last_active_at = datetime.now(timezone.utc)
    db.commit()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> User:
    """
    Dependency that restricts access to the admin account only.
    """
    if current_user.email != settings.admin_email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


RequireAdmin = Annotated[User, Depends(require_admin)]
