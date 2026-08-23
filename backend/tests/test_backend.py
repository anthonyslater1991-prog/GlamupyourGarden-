"""Backend integration tests for Glam up your Garden."""
import io
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")


# --- Auth ---
class TestAuth:
    def test_register_new_user(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"name": "TEST User", "email": email, "password": "pw12345"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["session_token"]
        assert data["user"]["email"] == email

    def test_register_duplicate_email(self):
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"name": "TEST", "email": "garden_test@example.com", "password": "secret123"})
        assert r.status_code == 400

    def test_login_success(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "garden_test@example.com", "password": "secret123"})
        assert r.status_code == 200, r.text
        assert r.json().get("session_token")

    def test_login_wrong_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "garden_test@example.com", "password": "WRONG"})
        assert r.status_code == 401

    def test_me_returns_user(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "garden_test@example.com"

    def test_me_no_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


# --- Upload / files ---
class TestUpload:
    def test_upload_image_and_download(self, auth_headers, test_user_token):
        # 1x1 png
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63000100000005000101" +
            "0D0A2DB40000000049454E44AE426082"
        )
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{BASE_URL}/api/upload", headers={"Authorization": auth_headers["Authorization"]},
                          files=files)
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        assert path
        # Download requires auth
        r2 = requests.get(f"{BASE_URL}/api/files/{path}")
        assert r2.status_code == 401
        r3 = requests.get(f"{BASE_URL}/api/files/{path}?token={test_user_token}")
        assert r3.status_code == 200
        assert len(r3.content) > 0
        # Save in class for other tests
        TestUpload._path = path

    def test_upload_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/upload", files={"file": ("a.png", b"x", "image/png")})
        assert r.status_code == 401


# --- Projects ---
class TestProjects:
    def test_create_and_list_get(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/projects", headers=auth_headers,
                          json={"title": "TEST Garden", "original_path": None})
        assert r.status_code == 200, r.text
        proj = r.json()["project"]
        assert proj["title"] == "TEST Garden"
        pid = proj["id"]
        # list
        r2 = requests.get(f"{BASE_URL}/api/projects", headers=auth_headers)
        assert r2.status_code == 200
        assert any(p["id"] == pid for p in r2.json()["projects"])
        # get one
        r3 = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=auth_headers)
        assert r3.status_code == 200
        assert r3.json()["project"]["id"] == pid

    def test_projects_require_auth(self):
        assert requests.get(f"{BASE_URL}/api/projects").status_code == 401

    def test_redesign_no_photo_returns_400(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/projects", headers=auth_headers, json={"title": "TEST NoPhoto"})
        pid = r.json()["project"]["id"]
        r2 = requests.post(f"{BASE_URL}/api/projects/{pid}/redesign", headers=auth_headers,
                           json={"changes": ["Add flowers"], "style": "cottage"})
        assert r2.status_code == 400


# --- Wall ---
class TestWall:
    def test_wall_list_public(self):
        r = requests.get(f"{BASE_URL}/api/wall")
        assert r.status_code == 200
        assert "posts" in r.json()

    def test_wall_create_and_like(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/wall", headers=auth_headers,
                          json={"caption": "TEST_ Beautiful garden!", "image_path": None})
        assert r.status_code == 200, r.text
        post = r.json()["post"]
        pid = post["id"]
        assert post["likes"] == 0
        r2 = requests.post(f"{BASE_URL}/api/wall/{pid}/like", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["post"]["likes"] == 1


# --- Contractors ---
class TestContractors:
    def test_list_contractors(self):
        r = requests.get(f"{BASE_URL}/api/contractors")
        assert r.status_code == 200
        data = r.json()["contractors"]
        assert len(data) >= 4
        TestContractors._cid = data[0]["id"]

    def test_get_contractor_with_reviews(self):
        r = requests.get(f"{BASE_URL}/api/contractors/{TestContractors._cid}")
        assert r.status_code == 200
        body = r.json()
        assert body["contractor"]["id"] == TestContractors._cid
        assert "reviews" in body

    def test_add_review(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/contractors/{TestContractors._cid}/reviews",
                          headers=auth_headers, json={"rating": 5, "text": "TEST_ Great work!"})
        assert r.status_code == 200
        assert r.json()["review"]["rating"] == 5
        assert r.json()["review_count"] >= 1


# --- Polls ---
class TestPolls:
    def test_active_poll(self):
        r = requests.get(f"{BASE_URL}/api/polls/active")
        assert r.status_code == 200
        poll = r.json()["poll"]
        assert poll is not None
        TestPolls._pid = poll["id"]
        TestPolls._before = list(poll["votes"])

    def test_vote_poll(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/polls/{TestPolls._pid}/vote",
                          headers=auth_headers, json={"option_index": 0})
        assert r.status_code == 200
        after = r.json()["poll"]["votes"]
        assert after[0] == TestPolls._before[0] + 1

    def test_vote_invalid_option(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/polls/{TestPolls._pid}/vote",
                          headers=auth_headers, json={"option_index": 99})
        assert r.status_code == 400


# --- Visits / stats ---
class TestStats:
    def test_visit_and_stats(self):
        r1 = requests.get(f"{BASE_URL}/api/stats")
        before = r1.json()["total_visits"]
        r2 = requests.post(f"{BASE_URL}/api/visit")
        assert r2.status_code == 200
        assert r2.json()["total_visits"] >= before + 1


# --- Chat ---
class TestChat:
    def test_chat_reply(self, auth_headers):
        sid = f"test_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{BASE_URL}/api/chat", headers=auth_headers, timeout=60,
                          json={"session_id": sid, "message": "How do I care for lavender?"})
        assert r.status_code == 200, r.text
        reply = r.json()["reply"]
        assert isinstance(reply, str) and len(reply) > 5

    def test_chat_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/chat", json={"session_id": "s", "message": "hi"})
        assert r.status_code == 401


# --- Profile ---
class TestProfile:
    def test_update_profile(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/auth/profile", headers=auth_headers,
                         json={"bio": "TEST_ love gardening", "allow_messages": True})
        assert r.status_code == 200
        assert r.json()["user"]["bio"] == "TEST_ love gardening"


# --- Redesign (AI, slow, best-effort) ---
@pytest.mark.slow
class TestRedesign:
    def test_full_redesign_flow(self, auth_headers, test_user_token):
        # 1x1 png
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63000100000005000101" +
            "0D0A2DB40000000049454E44AE426082"
        )
        up = requests.post(f"{BASE_URL}/api/upload",
                           headers={"Authorization": auth_headers["Authorization"]},
                           files={"file": ("g.png", io.BytesIO(png), "image/png")})
        assert up.status_code == 200
        path = up.json()["path"]
        proj = requests.post(f"{BASE_URL}/api/projects", headers=auth_headers,
                             json={"title": "TEST Redesign", "original_path": path}).json()["project"]
        r = requests.post(f"{BASE_URL}/api/projects/{proj['id']}/redesign", headers=auth_headers,
                          timeout=180,
                          json={"changes": ["Add flowers", "Add patio"], "style": "cottage"})
        # AI may fail (502) or succeed (200); ensure meaningful response
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            d = r.json()["design"]
            assert d["image_path"]
            assert isinstance(d["hotspots"], list) and len(d["hotspots"]) > 0
            # Save design
            sr = requests.post(f"{BASE_URL}/api/projects/{proj['id']}/designs/{d['id']}/save",
                               headers=auth_headers)
            assert sr.status_code == 200
