"""V14 Backend tests: Favourite Design + Share-Image (branded before/after PNG).

Covers:
  - POST /api/projects/{project_id}/designs/{design_id}/favourite
      * 401 unauthenticated
      * 404 for unknown project / unknown design
      * toggles designs.$.favourite = True/False; verified via GET /api/projects/{id}
  - POST /api/projects/{project_id}/share-image
      * 401 unauthenticated
      * 400 when project has no original photo
      * 404 unknown design
      * returns {image_path}; the file is downloadable via GET /api/files/{path}
        and is a real non-trivial PNG (magic bytes + content-type image/png).
"""

import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image as PILImage


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")


# ---------------------------------------------------------------------------
# Session fixtures - fresh user with an uploaded original photo + 1 real design
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def owner_token():
    email = f"TEST_v14_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": "V14 Tester", "email": email, "password": "TestPass123!"},
        timeout=30,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def other_token():
    email = f"TEST_v14b_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": "V14 Other", "email": email, "password": "TestPass123!"},
        timeout=30,
    )
    assert r.status_code == 200
    return r.json()["session_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def uploaded_photo_path(owner_token):
    # generate a tiny valid JPEG in-memory (green square)
    im = PILImage.new("RGB", (240, 180), (60, 130, 70))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=70)
    buf.seek(0)
    r = requests.post(
        f"{BASE_URL}/api/upload",
        headers={"Authorization": f"Bearer {owner_token}"},
        files={"file": ("garden.jpg", buf, "image/jpeg")},
        timeout=60,
    )
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
    return r.json()["path"]


@pytest.fixture(scope="module")
def project_with_design(owner_token, uploaded_photo_path):
    """Create a project with an uploaded photo AND run ONE real Gemini redesign
    so we have a design_id for favourite + share-image tests. This costs ~12-20s."""
    r = requests.post(
        f"{BASE_URL}/api/projects",
        headers=_headers(owner_token),
        json={"title": "TEST_v14_project", "original_path": uploaded_photo_path},
        timeout=30,
    )
    assert r.status_code == 200
    proj = r.json()["project"]
    pid = proj["id"]

    # Real Gemini call (~10-20s). Necessary for design_id.
    rr = requests.post(
        f"{BASE_URL}/api/projects/{pid}/redesign",
        headers=_headers(owner_token),
        json={"changes": ["Add flowers"], "style": "Tranquil"},
        timeout=120,
    )
    assert rr.status_code == 200, f"redesign failed: {rr.status_code} {rr.text}"
    design = rr.json()["design"]
    return {"project_id": pid, "design_id": design["id"], "design": design}


@pytest.fixture(scope="module")
def empty_project(owner_token):
    """Project with NO original_path — used to assert 400 on share-image."""
    r = requests.post(
        f"{BASE_URL}/api/projects",
        headers=_headers(owner_token),
        json={"title": "TEST_v14_empty"},
        timeout=30,
    )
    assert r.status_code == 200
    return r.json()["project"]["id"]


# ---------------------------------------------------------------------------
# Favourite endpoint
# ---------------------------------------------------------------------------
class TestFavouriteDesign:
    def test_favourite_requires_auth(self, project_with_design):
        pid = project_with_design["project_id"]
        did = project_with_design["design_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/designs/{did}/favourite",
            json={"favourite": True},
            timeout=15,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_favourite_unknown_project_returns_404(self, owner_token, project_with_design):
        did = project_with_design["design_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/proj_doesnotexist/designs/{did}/favourite",
            headers=_headers(owner_token),
            json={"favourite": True},
            timeout=15,
        )
        assert r.status_code == 404

    def test_favourite_unknown_design_returns_404(self, owner_token, project_with_design):
        pid = project_with_design["project_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/designs/design_nope/favourite",
            headers=_headers(owner_token),
            json={"favourite": True},
            timeout=15,
        )
        assert r.status_code == 404

    def test_non_owner_cannot_favourite(self, other_token, project_with_design):
        pid = project_with_design["project_id"]
        did = project_with_design["design_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/designs/{did}/favourite",
            headers=_headers(other_token),
            json={"favourite": True},
            timeout=15,
        )
        assert r.status_code == 404, f"expected 404 (owner-only), got {r.status_code}"

    def test_toggle_true_then_false_persists(self, owner_token, project_with_design):
        pid = project_with_design["project_id"]
        did = project_with_design["design_id"]

        # set true
        r1 = requests.post(
            f"{BASE_URL}/api/projects/{pid}/designs/{did}/favourite",
            headers=_headers(owner_token),
            json={"favourite": True},
            timeout=15,
        )
        assert r1.status_code == 200
        body = r1.json()
        assert body.get("ok") is True and body.get("favourite") is True

        g1 = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=_headers(owner_token), timeout=15)
        assert g1.status_code == 200
        d = next((x for x in g1.json()["project"]["designs"] if x["id"] == did), None)
        assert d is not None, "design missing from project"
        assert d.get("favourite") is True, f"favourite not persisted (True) - got {d.get('favourite')}"

        # set false
        r2 = requests.post(
            f"{BASE_URL}/api/projects/{pid}/designs/{did}/favourite",
            headers=_headers(owner_token),
            json={"favourite": False},
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json().get("favourite") is False

        g2 = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=_headers(owner_token), timeout=15)
        d2 = next((x for x in g2.json()["project"]["designs"] if x["id"] == did), None)
        assert d2.get("favourite") is False, f"favourite not persisted (False) - got {d2.get('favourite')}"


# ---------------------------------------------------------------------------
# Share-image endpoint
# ---------------------------------------------------------------------------
class TestShareImage:
    def test_share_image_requires_auth(self, project_with_design):
        pid = project_with_design["project_id"]
        did = project_with_design["design_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/share-image",
            json={"design_id": did},
            timeout=30,
        )
        assert r.status_code == 401

    def test_share_image_unknown_project_404(self, owner_token, project_with_design):
        did = project_with_design["design_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/proj_missing_abcdef/share-image",
            headers=_headers(owner_token),
            json={"design_id": did},
            timeout=30,
        )
        assert r.status_code == 404

    def test_share_image_no_original_photo_400(self, owner_token, empty_project, project_with_design):
        did = project_with_design["design_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{empty_project}/share-image",
            headers=_headers(owner_token),
            json={"design_id": did},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_share_image_unknown_design_404(self, owner_token, project_with_design):
        pid = project_with_design["project_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/share-image",
            headers=_headers(owner_token),
            json={"design_id": "design_nope"},
            timeout=30,
        )
        assert r.status_code == 404

    def test_share_image_returns_valid_png(self, owner_token, project_with_design):
        pid = project_with_design["project_id"]
        did = project_with_design["design_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/share-image",
            headers=_headers(owner_token),
            json={"design_id": did},
            timeout=60,
        )
        assert r.status_code == 200, f"share-image failed: {r.status_code} {r.text}"
        body = r.json()
        assert "image_path" in body and isinstance(body["image_path"], str)
        path = body["image_path"]
        assert path.endswith(".png") and "/shares/" in path

        # Fetch via /api/files/{path} — must be authed
        f_unauth = requests.get(f"{BASE_URL}/api/files/{path}", timeout=30)
        assert f_unauth.status_code == 401, f"files/ should require auth, got {f_unauth.status_code}"

        f = requests.get(
            f"{BASE_URL}/api/files/{path}",
            headers={"Authorization": f"Bearer {owner_token}"},
            timeout=30,
        )
        assert f.status_code == 200
        assert f.headers.get("content-type", "").startswith("image/png"), f.headers.get("content-type")
        data = f.content
        assert len(data) > 5000, f"PNG too small ({len(data)} bytes) — composition likely failed"
        assert data[:8] == b"\x89PNG\r\n\x1a\n", "missing PNG magic bytes"

        # Verify Pillow can parse it and it's a wide before/after composition
        im = PILImage.open(io.BytesIO(data))
        assert im.format == "PNG"
        assert im.width > im.height, f"expected landscape before/after canvas, got {im.size}"
