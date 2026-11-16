"""
Production startup guards. Fail closed (or warn loudly) on insecure config.

Called from `create_app()` so the process refuses to boot when running in
production with the worst kinds of insecure defaults. Each guard maps to a
security-audit item:

- secret_key default → audit #4. HARD refusal — no infra excuse not to set this.
- server-side code execution → removed entirely. Student code only ever
  runs in the browser (Pyodide in a Web Worker); the server never executes
  user-supplied code, so there is no sandbox to misconfigure.
"""

import logging

from app.config import Settings

logger = logging.getLogger(__name__)


_DEFAULT_SECRET_KEY = "change-me-in-production"


class InsecureProductionConfigError(RuntimeError):
    """Raised on boot when production config would expose a known vulnerability."""


def validate_production_settings(settings: Settings) -> None:
    """Refuse to start in production with the worst defaults; warn on the rest."""
    if settings.app_env != "production":
        return

    if settings.secret_key == _DEFAULT_SECRET_KEY or not settings.secret_key:
        raise InsecureProductionConfigError(
            "SECRET_KEY is the placeholder default; set a strong random value in env."
        )
