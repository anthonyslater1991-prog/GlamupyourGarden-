"""V12 — Admin AI Redesign Sandbox tests.

Verifies /api/admin/sandbox-redesign:
- 401 unauth
- 403 non-admin
- returns {image_path, prompt, hotspots}
- prompt reflects filters
- image_path is servable via GET /files/{path}
- NO project or design is created (compare counts before/after)
"""
import io
import os
import uuid
import pytest
import requests
from PIL import Image

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@glamgarden.app"
ADMIN_PASSWORD = "GlamAdmin2026!"


# ---------- helpers ----------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("session_token") or j.get("token")


def _register(email, password, name):
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=20)
    if r.status_code == 400:
        return _login(email, password)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("session_token") or j.get("token")


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


def _tiny_jpg_bytes():
    buf = io.BytesIO()
    img = Image.new("RGB", (64, 64), (80, 140, 80))
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def _upload(tok):
    files = {"file": ("garden.jpg", _tiny_jpg_bytes(), "image/jpeg")}
    r = requests.post(f"{API}/upload", files=files, headers=_headers(tok), timeout=30)
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
    return r.json()["path"]


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def customer_token():
    email = f"TEST_sandbox_cust_{uuid.uuid4().hex[:6]}@example.com"
    return _register(email, "SandboxTest123!", "TEST Sandbox Customer")


# ---------- tests ----------

class TestSandboxAuth:
    """Auth guards on /admin/sandbox-redesign."""

    def test_sandbox_unauth_401(self):
        r = requests.post(f"{API}/admin/sandbox-redesign", json={"original_path": "x", "changes": []}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code} {r.text}"

    def test_sandbox_non_admin_403(self, customer_token):
        # Customer needs a real uploaded path or the endpoint may 400 first.
        # But role check happens before validation, so we can send any body.
        r = requests.post(
            f"{API}/admin/sandbox-redesign",
            json={"original_path": "x", "changes": []},
            headers=_headers(customer_token),
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


class TestSandboxRedesign:
    """Happy path: admin generates a sandbox redesign — no project/design saved."""

    def test_full_flow_no_persistence(self, admin_token):
        # 1) counts BEFORE
        pr_before = requests.get(f"{API}/admin/projects", headers=_headers(admin_token), timeout=20)
        assert pr_before.status_code == 200, pr_before.text
        before_projects = pr_before.json().get("projects", [])
        before_project_count = len(before_projects)
        before_design_count = sum(p.get("design_count", 0) for p in before_projects)

        # 2) upload an image
        original_path = _upload(admin_token)
        assert original_path

        # 3) call sandbox-redesign with rich filters
        body = {
            "original_path": original_path,
            "changes": ["Add flowers", "Garden lighting"],
            "style": "Modern",
            "garden_type": "Zen",
            "mood": "Tranquil",
            "colour_scheme": "Whites & pastels",
            "ornaments": ["Water feature", "Pergola"],
            "wishlist": ["Weber BBQ", "rattan sofa"],
            "must_haves": "keep the old oak tree",
            "notes": "TEST_v12 sandbox call",
        }
        r = requests.post(f"{API}/admin/sandbox-redesign", json=body, headers=_headers(admin_token), timeout=90)
        assert r.status_code == 200, f"sandbox failed: {r.status_code} {r.text}"
        data = r.json()

        # 4) response shape
        assert "image_path" in data and isinstance(data["image_path"], str) and data["image_path"], data
        assert "prompt" in data and isinstance(data["prompt"], str) and data["prompt"], data
        assert "hotspots" in data and isinstance(data["hotspots"], list), data
        assert data["image_path"].startswith("APP/sandbox/") or "/sandbox/" in data["image_path"], \
            f"expected sandbox path, got {data['image_path']}"

        # 5) prompt reflects filters
        p = data["prompt"]
        assert "Modern" in p, f"style not in prompt: {p}"
        assert "Add flowers" in p and "Garden lighting" in p, f"changes not in prompt: {p}"
        assert "Zen" in p and "Tranquil" in p and "Whites & pastels" in p, f"garden/mood/colour missing: {p}"
        assert "Water feature" in p and "Pergola" in p, f"ornaments missing: {p}"
        assert "Weber BBQ" in p and "rattan sofa" in p, f"wishlist missing: {p}"
        assert "keep the old oak tree" in p, f"must_haves missing: {p}"
        assert "TEST_v12 sandbox call" in p, f"notes missing: {p}"

        # 6) generated image is servable via /files
        f = requests.get(
            f"{API}/files/{data['image_path']}",
            headers=_headers(admin_token),
            timeout=30,
        )
        assert f.status_code == 200, f"file fetch failed: {f.status_code} {f.text[:200]}"
        assert f.headers.get("content-type", "").startswith("image/"), f.headers
        assert len(f.content) > 100

        # 7) counts AFTER — NO new project, NO new design
        pr_after = requests.get(f"{API}/admin/projects", headers=_headers(admin_token), timeout=20)
        assert pr_after.status_code == 200
        after_projects = pr_after.json().get("projects", [])
        after_project_count = len(after_projects)
        after_design_count = sum(p.get("design_count", 0) for p in after_projects)

        assert after_project_count == before_project_count, \
            f"project count changed: {before_project_count} -> {after_project_count}"
        assert after_design_count == before_design_count, \
            f"design count changed: {before_design_count} -> {after_design_count}"

    def test_missing_original_path_400(self, admin_token):
        # Pydantic will 422 since original_path is required; either 400 or 422 is acceptable
        r = requests.post(
            f"{API}/admin/sandbox-redesign",
            json={"changes": ["Add flowers"]},
            headers=_headers(admin_token),
            timeout=15,
        )
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code} {r.text}"
