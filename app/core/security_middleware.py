"""HTTP security middleware: response headers and request body size cap.

These are defense-in-depth measures that protect the app even if some other
layer has a bug:

* ``SecurityHeadersMiddleware`` adds standard browser-side defenses (CSP,
  X-Frame-Options, X-Content-Type-Options, Referrer-Policy). They make
  XSS, clickjacking, and content-sniffing attacks much harder.
* ``BodySizeLimitMiddleware`` rejects oversized requests before they get
  read into memory. Without this, a single huge POST can OOM the server
  (a cheap denial-of-service).
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp


# Production CSP for a same-origin React SPA served by FastAPI.
#
# What each directive does:
#   default-src 'self'        — everything not otherwise specified must come
#                               from our own origin.
#   script-src                — Pyodide runs in a Web Worker
#                               (public/py-worker.js). The worker fetches the
#                               loader from jsdelivr, checks its SHA-384
#                               against a pinned hash, and only then runs it
#                               from a blob: URL, so a compromised CDN can't
#                               swap the loader. blob: is needed for that step;
#                               blob URLs can only be minted by our own
#                               scripts. jsdelivr stays for the interpreter
#                               files the loader pulls in. 'wasm-unsafe-eval'
#                               is required to compile the WebAssembly
#                               interpreter.
#   style-src                 — 'unsafe-inline' covers Tailwind + dynamic
#                               style attributes in MentorApp.tsx.
#   img-src https:            — Google profile pictures and similar.
#   font-src                  — 'self' covers anything we self-host; data:
#                               covers small inlined fonts.
#   connect-src               — fetch/XHR/WebSocket; jsdelivr is allowed
#                               because Pyodide downloads wasm + stdlib
#                               from there at runtime.
#   frame-ancestors 'none'    — refuses to be loaded in any iframe
#                               (clickjacking defense, like X-Frame-Options).
#   object-src 'none'         — kills <object>/<embed>/<applet>, ancient
#                               plugin attack surface.
_PROD_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' blob: https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss: https://cdn.jsdelivr.net",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
    ]
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach security headers to every HTTP response."""

    def __init__(self, app: ASGIApp, *, is_production: bool) -> None:
        super().__init__(app)
        self._is_production = is_production

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        response: Response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        # Cross-origin isolation. Required for SharedArrayBuffer, which lets
        # the Python worker pause on input() until the student types a line,
        # and lets Stop interrupt a running program. It also stops other
        # sites from holding a reference to our window or embedding our
        # resources. Every cross-origin resource we load (the Pyodide CDN)
        # sends Cross-Origin-Resource-Policy: cross-origin, so nothing breaks.
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Embedder-Policy", "require-corp")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if self._is_production:
            headers.setdefault("Content-Security-Policy", _PROD_CSP)
            headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose declared ``Content-Length`` exceeds ``max_bytes``.

    This is a cheap first-pass guard. A malicious client can lie about
    Content-Length, so the underlying ASGI server should still enforce its
    own ceiling — but this stops the common case before our handlers run.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        super().__init__(app)
        self._max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > self._max_bytes:
                    return JSONResponse(
                        {"detail": "Request body too large."},
                        status_code=413,
                    )
            except ValueError:
                return JSONResponse(
                    {"detail": "Invalid Content-Length header."},
                    status_code=400,
                )
        return await call_next(request)
