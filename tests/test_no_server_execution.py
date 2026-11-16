"""
Guards for the "server never runs user code" rule.

Student code runs only in the browser (Pyodide in a Web Worker). These tests
fail loudly if a server-side execution path is ever reintroduced, and check
the headers the browser runner depends on.
"""

import importlib.util
import uuid

import pytest
from pydantic import ValidationError

from app.main import app
from app.schemas.assignment import SubmissionCreate


def test_execution_endpoints_are_gone(client):
    assert client.post("/api/v1/sandbox/run", json={"code": "print(1)"}).status_code == 404


def test_no_route_mentions_sandbox():
    paths = [getattr(route, "path", "") for route in app.routes]
    assert not [p for p in paths if "sandbox" in p], paths


@pytest.mark.parametrize(
    "module",
    ["app.sandbox", "app.api.ws_sandbox", "app.api.v1.sandbox", "app.services.sandbox_service"],
)
def test_executor_modules_are_deleted(module):
    assert importlib.util.find_spec(module) is None


def test_submission_requires_browser_result():
    """Without a status the old code fell back to running the code server-side."""
    with pytest.raises(ValidationError):
        SubmissionCreate(assignment_id=uuid.uuid4(), code="print(1)")
    with pytest.raises(ValidationError):
        SubmissionCreate(assignment_id=uuid.uuid4(), code="print(1)", status="run-it-on-the-server")
    ok = SubmissionCreate(assignment_id=uuid.uuid4(), code="print(1)", status="success")
    assert ok.status == "success"


def test_cross_origin_isolation_headers(client):
    """The browser runner needs isolation for input() and instant Stop."""
    r = client.get("/health")
    assert r.headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert r.headers["Cross-Origin-Embedder-Policy"] == "require-corp"
