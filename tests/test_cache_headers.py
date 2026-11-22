"""index.html must be rechecked on every visit; hashed assets can be cached forever.

Without this, browsers keep an old index.html after a deploy and load bundles
that no longer exist or expect the old API (a blank page).
"""

from fastapi.testclient import TestClient

import app.main as main


def test_page_is_revalidated_and_assets_are_immutable(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><script src='/assets/index-abc123.js'></script>")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path / "py-worker.js").write_text("// worker")
    monkeypatch.setattr(main, "FRONTEND_DIR", tmp_path)

    client = TestClient(main.create_app())
    for path in ("/", "/demo", "/app/some/route", "/py-worker.js"):
        assert client.get(path).headers.get("cache-control") == "no-cache", path
    asset = client.get("/assets/index-abc123.js")
    assert asset.status_code == 200
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    # A missing asset must not be cached as immutable.
    assert "immutable" not in client.get("/assets/missing.js").headers.get("cache-control", "")
