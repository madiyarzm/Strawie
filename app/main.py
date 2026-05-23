"""
FastAPI application entry point.

Lifespan: ensure DB is ready; later we can add migration checks or connection pools.
Routes: health check at root level; API under /api/v1; frontend static files at /.
"""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.router import api_router
from app.api import ws_collab, ws_sandbox
from app.config import get_settings
from app.core.limiter import limiter
from app.core.security_middleware import (
    BodySizeLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.startup_guards import validate_production_settings
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.services.submission_service import delete_expired_submissions

# 1 MB is enough for code submissions, JSON payloads, and config.
# Sandbox stdout/stderr are server-generated and don't pass through this limit.
_MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024

# Frontend directory relative to project root (where main.py's parent's parent is)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan hook. DB work runs in background so health check passes immediately.
    """
    import asyncio
    import logging

    logger = logging.getLogger(__name__)

    async def _startup() -> None:
        settings = get_settings()
        try:
            init_db()
        except Exception as exc:
            logger.error("init_db failed: %s", exc)
            return
        db = SessionLocal()
        try:
            delete_expired_submissions(db, retention_days=settings.submission_retention_days)
        except Exception as exc:
            logger.error("delete_expired_submissions failed: %s", exc)
        finally:
            db.close()

    asyncio.create_task(_startup())
    yield


def create_app() -> FastAPI:
    """Factory for the FastAPI app. Used by uvicorn and tests."""
    settings = get_settings()
    validate_production_settings(settings)
    app = FastAPI(
        title="Chalk",
        description="Collaborative coding classroom platform",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url="/redoc" if settings.app_env != "production" else None,
    )

    allowed_origins = [settings.frontend_url]
    if settings.app_env != "production":
        allowed_origins += ["http://localhost:5173", "http://localhost:8000"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Middleware order note: Starlette runs middlewares in reverse of the
    # order they're added (last added = outermost). We want the body size
    # check to run before everything else, so it's added last.
    app.add_middleware(
        SecurityHeadersMiddleware,
        is_production=(settings.app_env == "production"),
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=_MAX_REQUEST_BODY_BYTES)

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    app.include_router(api_router, prefix="/api")
    # WebSocket endpoints (not versioned).
    app.include_router(ws_collab.router)
    app.include_router(ws_sandbox.router)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        from sqlalchemy import text
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            return {"status": "ok", "service": "chalk"}
        except Exception:
            return {"status": "db_error"}
        finally:
            db.close()

    # Serve frontend static files.
    # Assets (JS/CSS/images) are served directly; all other paths fall back to
    # index.html so that React Router (BrowserRouter) handles client-side navigation.
    if FRONTEND_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str) -> FileResponse:
            candidate = (FRONTEND_DIR / full_path).resolve()
            if candidate.is_relative_to(FRONTEND_DIR) and candidate.is_file():
                return FileResponse(str(candidate))
            return FileResponse(str(FRONTEND_DIR / "index.html"))

    return app


app = create_app()
