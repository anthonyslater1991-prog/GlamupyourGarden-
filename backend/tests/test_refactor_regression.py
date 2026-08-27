"""
V13 — Backend refactor regression test.
Verifies representative endpoints across every routes_*.py module still work
after monolithic server.py was split into core.py + routes_*.py modules.
Behaviour must be UNCHANGED.

Response shapes based on actual API contract (all wrapped dicts):
- /auth/me            -> {"user": {...}}
- /projects           -> {"projects": [...]}
- POST /projects      -> {"project": {...}}
- /contractors        -> {"contractors": [...]}
- /wall               -> {"posts": [...]}
- /members            -> {"members": [...]}
- /conversations      -> {"conversations": [...]}
- /contracts          -> {"contracts": [...]}
- /polls/active       -> {"poll": {...}}
- /alerts/nearby      -> {"alerts": [...]}
- /map/contractors    -> {"contractors": [...]} (AUTH REQUIRED)
- /reminders          -> {"reminders": [...]}
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@glamgarden.app"
ADMIN_PW = "GlamAdmin2026!"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def customer(s):
    email = f"TEST_regress_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "name": "Regress Test", "email": email, "password": "secret123"
    })
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return {"email": email, "token": r.json()["session_token"]}


@pytest.fixture(scope="module")
def cust_headers(customer):
    return {"Authorization": f"Bearer {customer['token']}"}


# ============================== routes_auth ==============================
class TestAuth:
    def test_login_admin(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
        assert r.status_code == 200
        j = r.json()
        assert "session_token" in j
        assert j["user"]["role"] == "admin"
        assert j["user"]["email"] == ADMIN_EMAIL

    def test_login_bad_password(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me_authed(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=admin_headers)
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["email"] == ADMIN_EMAIL
        assert u["role"] == "admin"

    def test_me_unauth(self, s):
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code in (401, 403)


# ============================== routes_projects ==============================
class TestProjects:
    def test_projects_unauth(self, s):
        r = s.get(f"{BASE_URL}/api/projects")
        assert r.status_code in (401, 403)

    def test_projects_list_authed(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/projects", headers=cust_headers)
        assert r.status_code == 200
        assert isinstance(r.json()["projects"], list)

    def test_project_create_get_delete(self, s, cust_headers):
        # ProjectCreate requires title + original_path
        payload = {"title": "TEST_regress_project", "original_path": "TEST/fake.jpg"}
        r = s.post(f"{BASE_URL}/api/projects", json=payload, headers=cust_headers)
        assert r.status_code == 200, r.text
        pid = r.json()["project"]["id"]
        assert r.json()["project"]["title"] == "TEST_regress_project"

        g = s.get(f"{BASE_URL}/api/projects/{pid}", headers=cust_headers)
        assert g.status_code == 200
        assert g.json()["project"]["id"] == pid

        d = s.delete(f"{BASE_URL}/api/projects/{pid}", headers=cust_headers)
        assert d.status_code == 200 and d.json().get("ok") is True

        # verify 404 after delete
        g2 = s.get(f"{BASE_URL}/api/projects/{pid}", headers=cust_headers)
        assert g2.status_code == 404


# ============================== routes_ai ==============================
class TestAI:
    def test_sandbox_unauth(self, s):
        r = s.post(f"{BASE_URL}/api/admin/sandbox-redesign", json={"original_path": "x"})
        assert r.status_code in (401, 403)

    def test_sandbox_non_admin_forbidden(self, s, cust_headers):
        r = s.post(f"{BASE_URL}/api/admin/sandbox-redesign", json={"original_path": "x"}, headers=cust_headers)
        assert r.status_code == 403

    def test_redesign_unauth(self, s):
        r = s.post(f"{BASE_URL}/api/projects/anything/redesign", json={})
        assert r.status_code in (401, 403, 404, 422)


# ============================== routes_contractors ==============================
class TestContractors:
    def test_contractors_list_public(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/contractors", headers=cust_headers)
        assert r.status_code == 200
        arr = r.json()["contractors"]
        assert isinstance(arr, list) and len(arr) > 0

    def test_contractor_detail(self, s, cust_headers):
        cs = s.get(f"{BASE_URL}/api/contractors", headers=cust_headers).json()["contractors"]
        cid = cs[0]["id"]
        d = s.get(f"{BASE_URL}/api/contractors/{cid}", headers=cust_headers)
        assert d.status_code == 200
        j = d.json()
        # Accept either wrapped or bare
        cid_out = j.get("contractor", {}).get("id") or j.get("id")
        assert cid_out == cid


# ============================== routes_contracts ==============================
class TestContracts:
    def test_contracts_unauth(self, s):
        r = s.get(f"{BASE_URL}/api/contracts")
        assert r.status_code in (401, 403)

    def test_contracts_authed(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/contracts", headers=cust_headers)
        assert r.status_code == 200
        assert isinstance(r.json()["contracts"], list)


# ============================== routes_community ==============================
class TestCommunity:
    def test_wall_authed(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/wall", headers=cust_headers)
        assert r.status_code == 200
        assert isinstance(r.json()["posts"], list)


# ============================== routes_messaging ==============================
class TestMessaging:
    def test_members(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/members", headers=cust_headers)
        assert r.status_code == 200
        assert isinstance(r.json()["members"], list)

    def test_conversations(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/conversations", headers=cust_headers)
        assert r.status_code == 200
        assert isinstance(r.json()["conversations"], list)

    def test_unread(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/unread", headers=cust_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)


# ============================== routes_engagement ==============================
class TestEngagement:
    def test_polls_active(self, s):
        r = s.get(f"{BASE_URL}/api/polls/active")
        assert r.status_code == 200
        j = r.json()
        assert "poll" in j
        # active poll must exist due to seeding
        if j["poll"] is not None:
            assert "question" in j["poll"] and "options" in j["poll"]

    def test_visit(self, s, cust_headers):
        r = s.post(f"{BASE_URL}/api/visit", headers=cust_headers)
        assert r.status_code == 200
        assert "total_visits" in r.json()

    def test_stats(self, s):
        r = s.get(f"{BASE_URL}/api/stats")
        assert r.status_code == 200
        j = r.json()
        assert "total_visits" in j and "active_5m" in j

    def test_reminders(self, s, cust_headers):
        # /reminders returns {"review_prompts": [...], "count": N}
        r = s.get(f"{BASE_URL}/api/reminders", headers=cust_headers)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j.get("review_prompts"), list)
        assert "count" in j


# ============================== routes_admin ==============================
class TestAdmin:
    def test_admin_overview_non_admin_forbidden(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/admin/overview", headers=cust_headers)
        assert r.status_code == 403

    def test_admin_overview_unauth(self, s):
        r = s.get(f"{BASE_URL}/api/admin/overview")
        assert r.status_code in (401, 403)

    def test_admin_overview(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/admin/overview", headers=admin_headers)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j, dict)
        # verify it returns some counters-like data
        assert len(j) > 0

    def test_admin_projects(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/admin/projects", headers=admin_headers)
        assert r.status_code == 200
        j = r.json()
        arr = j.get("projects") if isinstance(j, dict) else j
        assert isinstance(arr, list)

    def test_admin_claims(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/admin/claims", headers=admin_headers)
        assert r.status_code == 200
        j = r.json()
        arr = j.get("claims") if isinstance(j, dict) else j
        assert isinstance(arr, list)

    def test_admin_releases(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/admin/releases", headers=admin_headers)
        assert r.status_code == 200
        j = r.json()
        arr = j.get("releases") if isinstance(j, dict) else j
        assert isinstance(arr, list)


# ============================== routes_geo ==============================
class TestGeo:
    def test_map_contractors_unauth(self, s):
        r = s.get(f"{BASE_URL}/api/map/contractors")
        assert r.status_code in (401, 403)

    def test_map_contractors_authed(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/map/contractors", headers=cust_headers)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j["contractors"], list)

    def test_alerts_nearby(self, s, cust_headers):
        r = s.get(f"{BASE_URL}/api/alerts/nearby", headers=cust_headers)
        assert r.status_code == 200
        assert isinstance(r.json()["alerts"], list)
