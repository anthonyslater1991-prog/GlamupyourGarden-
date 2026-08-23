"""V10 Stripe Connect payouts / admin releases / settings — graceful 503 tests.

Focus:
- /admin/settings GET+POST as admin (persistence)
- /admin/releases GET as admin (does not crash, returns connect_enabled=False + fee_percent)
- /connect/onboard as contractor -> 503 friendly message
- /connect/status as contractor with no approved claim -> connected=False
- Regression: admin claims approve flow works
"""
import os
import uuid
import time
import requests
import pytest

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")

API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@glamgarden.app"
ADMIN_PASSWORD = "GlamAdmin2026!"


# ----------------- helpers -----------------

def _login(api_client, email, password):
    r = api_client.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


def _register(api_client, name, email, password, role="customer"):
    body = {"name": name, "email": email, "password": password, "role": role}
    r = api_client.post(f"{API}/auth/register", json=body)
    assert r.status_code == 200, f"register {email} failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_token(api_client):
    return _login(api_client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def fresh_contractor(api_client):
    """Register a fresh contractor account (no listing claimed yet)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_con_{suffix}@example.com"
    password = "secret123"
    token = _register(api_client, f"TEST_Con {suffix}", email, password, role="contractor")
    return {"email": email, "password": password, "token": token,
            "headers": {"Authorization": f"Bearer {token}"}}


# ----------------- admin settings -----------------

class TestAdminSettings:
    def test_admin_settings_get(self, api_client, admin_headers):
        r = api_client.get(f"{API}/admin/settings", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "platform_fee_percent" in data
        assert "connect_enabled" in data
        assert isinstance(data["platform_fee_percent"], (int, float))
        assert isinstance(data["connect_enabled"], bool)

    def test_admin_settings_requires_admin(self, api_client, auth_headers):
        r = api_client.get(f"{API}/admin/settings", headers=auth_headers)
        assert r.status_code == 403

    def test_admin_settings_post_persists(self, api_client, admin_headers):
        # save original
        orig = api_client.get(f"{API}/admin/settings", headers=admin_headers).json()["platform_fee_percent"]
        try:
            new_val = 15.0 if orig != 15.0 else 12.0
            r = api_client.post(f"{API}/admin/settings",
                                headers=admin_headers,
                                json={"platform_fee_percent": new_val})
            assert r.status_code == 200, r.text
            assert r.json()["platform_fee_percent"] == new_val

            # GET verifies persistence
            r2 = api_client.get(f"{API}/admin/settings", headers=admin_headers)
            assert r2.status_code == 200
            assert r2.json()["platform_fee_percent"] == new_val

            # also reflected in /admin/releases
            r3 = api_client.get(f"{API}/admin/releases", headers=admin_headers)
            assert r3.status_code == 200
            assert r3.json()["fee_percent"] == new_val
        finally:
            # restore original
            api_client.post(f"{API}/admin/settings", headers=admin_headers,
                            json={"platform_fee_percent": orig})

    def test_admin_settings_clamped(self, api_client, admin_headers):
        r = api_client.post(f"{API}/admin/settings", headers=admin_headers,
                            json={"platform_fee_percent": 999})
        assert r.status_code == 200
        assert r.json()["platform_fee_percent"] == 50.0
        r = api_client.post(f"{API}/admin/settings", headers=admin_headers,
                            json={"platform_fee_percent": -5})
        assert r.status_code == 200
        assert r.json()["platform_fee_percent"] == 0.0
        # restore 10
        api_client.post(f"{API}/admin/settings", headers=admin_headers,
                        json={"platform_fee_percent": 10})


# ----------------- admin releases -----------------

class TestAdminReleases:
    def test_admin_releases_get(self, api_client, admin_headers):
        r = api_client.get(f"{API}/admin/releases", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "releases" in data
        assert "fee_percent" in data
        assert "connect_enabled" in data
        assert isinstance(data["releases"], list)
        # In this env, real Stripe key missing -> false
        assert data["connect_enabled"] is False, "Expected connect_enabled False in this env"
        # Each release row shape sanity check (only if any exist)
        for row in data["releases"]:
            for k in ["contract_id", "project_title", "customer_name", "contractor_name",
                      "deposit_amount", "platform_fee", "net_to_contractor",
                      "payouts_enabled", "has_stripe_account"]:
                assert k in row, f"missing {k} in release row"

    def test_admin_releases_requires_admin(self, api_client, auth_headers):
        r = api_client.get(f"{API}/admin/releases", headers=auth_headers)
        assert r.status_code == 403


# ----------------- connect (contractor side) -----------------

class TestConnect:
    def test_connect_status_no_claim(self, api_client, fresh_contractor):
        r = api_client.get(f"{API}/connect/status", headers=fresh_contractor["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("connected") is False
        assert data.get("payouts_enabled") is False
        assert data.get("onboarded") is False

    def test_connect_onboard_no_claim_403(self, api_client, fresh_contractor):
        r = api_client.post(f"{API}/connect/onboard",
                            headers=fresh_contractor["headers"],
                            json={"origin": "https://example.com"})
        # Without an approved claim, server returns 503 first (real_stripe False)
        # or 403 depending on order. Current code: _connect_guard() first -> 503.
        assert r.status_code == 503, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "stripe" in detail
        assert "test key" in detail

    def test_connect_onboard_customer_forbidden(self, api_client, auth_headers):
        # A customer with no owned contractor also gets 503 (guard first).
        r = api_client.post(f"{API}/connect/onboard",
                            headers=auth_headers,
                            json={"origin": "https://example.com"})
        assert r.status_code == 503

    def test_connect_onboard_requires_auth(self, api_client):
        r = api_client.post(f"{API}/connect/onboard",
                            json={"origin": "https://example.com"})
        assert r.status_code in (401, 403)


# ----------------- claim → approve flow (regression + payouts card gating) -----------------

class TestClaimAndPayoutsGating:
    def test_claim_and_approve_then_status(self, api_client, admin_headers, fresh_contractor):
        # list contractors, pick one without an owner (claim_status != approved)
        r = api_client.get(f"{API}/contractors")
        assert r.status_code == 200
        contractors = r.json()["contractors"]
        target = None
        for c in contractors:
            if c.get("claim_status") != "approved":
                target = c
                break
        if not target:
            pytest.skip("No claimable contractor listing available")

        cid = target["id"]

        # claim as fresh contractor
        r = api_client.post(f"{API}/contractors/{cid}/claim",
                            headers=fresh_contractor["headers"])
        assert r.status_code == 200, f"claim failed: {r.status_code} {r.text}"

        # admin sees claim
        r = api_client.get(f"{API}/admin/claims", headers=admin_headers)
        assert r.status_code == 200
        claims = r.json()["claims"]
        assert any(c["id"] == cid for c in claims), "New claim not visible to admin"

        # admin approves
        r = api_client.post(f"{API}/admin/claims/{cid}/action",
                            headers=admin_headers,
                            json={"action": "approve"})
        assert r.status_code == 200, r.text

        # contractor now sees own listing via /my-contractor
        r = api_client.get(f"{API}/my-contractor", headers=fresh_contractor["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data.get("contractor") is not None
        assert data["contractor"]["id"] == cid

        # connect/status still reports not payouts_enabled (no Stripe key)
        r = api_client.get(f"{API}/connect/status", headers=fresh_contractor["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data.get("payouts_enabled") is False

        # connect/onboard now returns 503 friendly message (still no key)
        r = api_client.post(f"{API}/connect/onboard",
                            headers=fresh_contractor["headers"],
                            json={"origin": "https://example.com"})
        assert r.status_code == 503
        detail = (r.json().get("detail") or "").lower()
        assert "stripe" in detail and "test key" in detail


# ----------------- release deposit guard -----------------

class TestReleaseGuard:
    def test_release_non_existing_contract_503_guard_first(self, api_client, admin_headers):
        # In current code order: admin check -> _connect_guard() -> not found.
        # So without real stripe, we get 503 before 404.
        r = api_client.post(f"{API}/admin/contracts/does-not-exist/release",
                            headers=admin_headers,
                            json={})
        assert r.status_code == 503
        detail = (r.json().get("detail") or "").lower()
        assert "stripe" in detail

    def test_release_requires_admin(self, api_client, auth_headers):
        r = api_client.post(f"{API}/admin/contracts/does-not-exist/release",
                            headers=auth_headers, json={})
        assert r.status_code == 403
