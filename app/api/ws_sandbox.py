"""
WebSocket endpoint for streaming interactive Python sandbox.

Runs user code in a subprocess with real-time stdout streaming and
interactive input() support. Security restrictions match the REST sandbox:
no open(), no unsafe imports, 512 KB output cap.

Protocol (JSON):
  Client → Server  {"code": "<python source>"}
  Server → Client  {"type": "stdout",        "text": "..."}
  Server → Client  {"type": "stderr",        "text": "..."}
  Server → Client  {"type": "input_request", "prompt": "..."}
  Client → Server  {"type": "input_response","value": "..."}
  Server → Client  {"type": "done",          "exit_code": 0}
"""

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, WebSocket
from jose import JWTError

from app.config import get_settings
from app.core.demo_auth import is_guest_payload
from app.core.security import decode_access_token
from app.core.ws_rate_limit import allow as ws_allow
from app.dependencies import AUTH_COOKIE_NAME
from app.sandbox.limits import DEFAULT_TIMEOUT_SECONDS, MAX_CODE_BYTES
from app.sandbox.subprocess_executor import sandbox_env

logger = logging.getLogger(__name__)

router = APIRouter()

# Interactive wall-clock limit — longer than the REST limit because the user
# needs time to type responses to input() prompts.
_INTERACTIVE_TIMEOUT = max(DEFAULT_TIMEOUT_SECONDS, 120)

# Same allowed-module set and builtin restrictions as subprocess_executor,
# but input() is patched to signal the parent via stderr JSON lines.
_STREAMING_RUNNER = r'''
import sys as _sys
import json as _json
import builtins as _builtins

_real_stderr = _sys.__stderr__
_real_stdin  = _sys.__stdin__

def _patched_input(prompt=""):
    _real_stderr.write(_json.dumps({"type": "input_request", "prompt": str(prompt)}) + "\n")
    _real_stderr.flush()
    line = _real_stdin.readline()
    return line.rstrip("\n")

_CODE_PATH = _sys.argv[1]
with open(_CODE_PATH, "r", encoding="utf-8") as _f:
    _code = _f.read()

_ALLOWED = frozenset((
    "math", "random", "json", "datetime", "re", "collections",
    "functools", "itertools", "string", "decimal", "fractions",
    "statistics", "typing", "dataclasses",
))

_orig_import = __import__

def _safe_import(name, *args, **kwargs):
    top = name.split(".")[0]
    if top not in _ALLOWED:
        raise ImportError("Module not allowed in sandbox: %s" % top)
    return _orig_import(name, *args, **kwargs)

_bd = __builtins__ if isinstance(__builtins__, dict) else __builtins__.__dict__
_safe = dict(_bd)
for _n in ("open", "exec", "eval", "compile", "file", "__import__", "reload"):
    _safe.pop(_n, None)
_safe["__import__"] = _safe_import
_safe["print"] = print
_safe["input"] = _patched_input

_globals = {"__builtins__": _safe, "__name__": "__main__"}

try:
    exec(compile(_code, _CODE_PATH, "exec"), _globals)
except SystemExit:
    pass
except Exception:
    import traceback
    traceback.print_exc()
    _sys.exit(1)
'''


@router.websocket("/ws/sandbox/run")
async def sandbox_run_ws(websocket: WebSocket) -> None:
    token = websocket.cookies.get(AUTH_COOKIE_NAME) or websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return

    try:
        settings = get_settings()
        payload = decode_access_token(token, settings=settings)
    except JWTError:
        await websocket.close(code=4401, reason="Invalid or expired token")
        return
    except Exception:
        await websocket.close(code=4500, reason="Internal error")
        return

    # Demo guests must never reach server-side execution. In production
    # SANDBOX_USE_DOCKER is false, so this endpoint runs user code as a
    # restricted subprocess inside the application container -- acceptable for
    # authenticated students, not for an anonymous public endpoint. The demo
    # runs Python entirely in the visitor's browser via Pyodide instead.
    if is_guest_payload(payload):
        await websocket.close(
            code=4403,
            reason="Demo mode runs Python in your browser, not on the server.",
        )
        return

    rate_id = payload.get("sub") or (websocket.client.host if websocket.client else "anon")
    if not await ws_allow(f"ws_sandbox:{rate_id}", max_per_minute=20):
        await websocket.close(code=4429, reason="Too many requests")
        return

    await websocket.accept()

    try:
        init = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
    except Exception:
        await websocket.send_json({"type": "done", "exit_code": -1})
        return

    code: str = init.get("code", "")
    if len(code.encode()) > MAX_CODE_BYTES:
        await websocket.send_json({"type": "stderr", "text": "Code too large.\n"})
        await websocket.send_json({"type": "done", "exit_code": -1})
        return

    with tempfile.TemporaryDirectory(prefix="chalk_ws_") as tmpdir:
        tmp = Path(tmpdir)
        code_path = tmp / "user_code.py"
        runner_path = tmp / "runner.py"
        code_path.write_text(code, encoding="utf-8")
        runner_path.write_text(_STREAMING_RUNNER.strip(), encoding="utf-8")

        proc = await asyncio.create_subprocess_exec(
            os.environ.get("SANDBOX_PYTHON", "python3"), "-u",
            str(runner_path), str(code_path),
            cwd=str(tmp),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=sandbox_env(),
        )

        # Queue bridges the ws-receiver coroutine → stderr-reader coroutine.
        # None is a sentinel meaning "client disconnected / give up".
        input_queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def _read_stdout() -> None:
            assert proc.stdout is not None
            while True:
                chunk = await proc.stdout.read(512)
                if not chunk:
                    break
                await websocket.send_json({"type": "stdout", "text": chunk.decode("utf-8", errors="replace")})

        async def _read_stderr() -> None:
            assert proc.stderr is not None and proc.stdin is not None
            while True:
                line = await proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                try:
                    obj = json.loads(text.strip())
                    if obj.get("type") == "input_request":
                        await websocket.send_json(obj)
                        try:
                            value = await asyncio.wait_for(input_queue.get(), timeout=60.0)
                        except asyncio.TimeoutError:
                            await websocket.send_json({"type": "stderr", "text": "\nInput timed out.\n"})
                            proc.kill()
                            return
                        if value is None:
                            proc.kill()
                            return
                        proc.stdin.write((value + "\n").encode("utf-8"))
                        await proc.stdin.drain()
                    else:
                        await websocket.send_json({"type": "stderr", "text": text})
                except (json.JSONDecodeError, ValueError):
                    await websocket.send_json({"type": "stderr", "text": text})

        async def _receive_ws() -> None:
            try:
                while True:
                    msg = await websocket.receive_json()
                    if msg.get("type") == "input_response":
                        await input_queue.put(msg.get("value", ""))
            except Exception:
                await input_queue.put(None)

        stdout_task = asyncio.create_task(_read_stdout())
        stderr_task = asyncio.create_task(_read_stderr())
        ws_recv_task = asyncio.create_task(_receive_ws())

        try:
            await asyncio.wait_for(
                asyncio.gather(stdout_task, stderr_task),
                timeout=_INTERACTIVE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            proc.kill()
            try:
                await websocket.send_json({"type": "stderr", "text": f"\nExecution timed out after {_INTERACTIVE_TIMEOUT}s.\n"})
            except Exception:
                pass
        except Exception as exc:
            logger.warning("Sandbox WS gather error: %s", exc)
            proc.kill()
        finally:
            ws_recv_task.cancel()
            try:
                await proc.wait()
            except Exception:
                pass
            try:
                await websocket.send_json({"type": "done", "exit_code": proc.returncode or 0})
            except Exception:
                pass
