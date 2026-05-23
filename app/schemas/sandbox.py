"""
Pydantic schemas for sandbox run request and response.

Used by the /sandbox/run endpoint. Real execution will be added
when Docker-based isolation is implemented.
"""

from pydantic import BaseModel, Field


class SandboxRunRequest(BaseModel):
    """
    Payload for running code in the sandbox.

    Args:
        code: Python source code to execute.
        stdin: Optional text to feed as standard input (for input() calls).
    """

    code: str = Field(max_length=100_000)
    stdin: str = Field(default="", max_length=10_000)


class SandboxRunResponse(BaseModel):
    """
    Response from sandbox execution.

    Stub returns simulated stdout/stderr. Real implementation
    will capture actual execution output.
    """

    status: str
    stdout: str = ""
    stderr: str = ""
    result_json: dict | None = None
