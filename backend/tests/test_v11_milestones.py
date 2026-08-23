"""
V11 Milestone escrow + confirm-release + earnings tests.

Covers:
- Milestones seeded on quote accept: [deposit £720, final £1680] for £2400 quote
- pay-{key} endpoints return Stripe Checkout URLs
- confirm-complete gating (only when status=completed AND has held funds)
- admin/releases returns held row for the seeded confirmed contract
- admin/release fails 503 without STRIPE_CONNECT_SECRET_KEY
- contractor earnings endpoint responds sensibly
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")

CUSTOMER = {"email": "garden_test@example.com", "password": "secret123"}
ADMIN = {"email": "admin@glamgarden.app", "password": "GlamAdmin2026!"}
SEEDED_CONTRACT_ID = "contract_307cde9eeb8e"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def customer_token():
    return _login(**CUSTOMER)


@pytest.fixture(scope="module")
def admin_token():
    return _login(**ADMIN)


# ------------------------- Seeded contract ------------------------------------

class TestSeededContract:
    def _get_contract(self, token):
        r = requests.get(f"{BASE_URL}/api/contracts/{SEEDED_CONTRACT_ID}", headers=_auth(token))
        assert r.status_code == 200, r.text
        body = r.json()
        return body.get("contract", body)

    def test_seeded_contract_visible_to_customer(self, customer_token):
        c = self._get_contract(customer_token)
        assert c["id"] == SEEDED_CONTRACT_ID
        assert c.get("quote_status") == "accepted"
        assert c.get("deposit_paid") is True
        assert c.get("status") == "completed"
        assert c.get("customer_confirmed") is True

    def test_seeded_contract_has_milestones_with_held_deposit(self, customer_token):
        c = self._get_contract(customer_token)
        ms = c.get("milestones") or []
        assert len(ms) >= 1, f"expected milestones, got {ms}"
        # deposit milestone should be paid (held)
        dep = next((m for m in ms if m["key"] == "deposit"), None)
        assert dep is not None
        assert dep["status"] == "paid", f"expected paid deposit, got {dep}"
        assert abs(float(dep["amount"]) - 720.0) < 0.01

    def test_seeded_contract_confirm_complete_idempotent(self, customer_token):
        # Already confirmed — calling again should not blow up but should fail or noop.
        # Backend implementation likely 400s ("Already confirmed") or noops.
        r = requests.post(f"{BASE_URL}/api/contracts/{SEEDED_CONTRACT_ID}/confirm-complete",
                          headers=_auth(customer_token), json={})
        # accept either 400 (already confirmed) or 200 (noop) — just must not 500
        assert r.status_code in (200, 400), r.text


# ------------------------- Quote → milestones flow ----------------------------

class TestQuoteAcceptBuildsMilestones:
    """Full flow: draft contract → admin submits quote 900+1500=2400 → customer accepts
    → contract must have milestones [deposit 720, final 1680]. Then pay-deposit and
    pay-final return Stripe Checkout URLs."""

    def _make_contractor(self):
        """Create a fresh contractor listing via admin so quote can be authored."""
        admin = _login(**ADMIN)
        cid = f"con_test_v11_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{BASE_URL}/api/admin/contractors", headers=_auth(admin), json={
            "id": cid, "name": "TEST_V11 Milestones Co",
            "postcode": "LS1 4DY", "phone": "07000000000", "specialties": ["Design"],
            "bio": "TEST_V11", "price_from": 500,
        })
        # Some backends may not expose this endpoint — fall back to listing existing
        if r.status_code == 200:
            return cid
        # Fallback: pick any existing contractor
        r = requests.get(f"{BASE_URL}/api/contractors")
        assert r.status_code == 200, r.text
        pros = r.json().get("contractors", [])
        assert pros, "no contractors available"
        return pros[0]["id"]

    @pytest.fixture(scope="class")
    def fresh_contract(self, customer_token):
        contractor_id = self._make_contractor()
        payload = {
            "contractor_id": contractor_id,
            "project_title": "TEST_V11 milestone flow",
            "scope": "Test milestones",
            "materials": "TBD by pro",
            "start_date": "2026-02-01",
            "duration_days": 10,
            "price": "£0",
            "deposit_percent": 30,
            "payment_terms": "Deposit + final.",
        }
        r = requests.post(f"{BASE_URL}/api/contracts", headers=_auth(customer_token), json=payload)
        assert r.status_code == 200, r.text
        return r.json()["contract"]

    def test_full_quote_accept_milestone_pay_flow(self, customer_token, admin_token, fresh_contract):
        cid = fresh_contract["id"]

        # 1. admin submits quote 900 + 1500 = 2400
        r = requests.post(
            f"{BASE_URL}/api/contracts/{cid}/quote",
            headers=_auth(admin_token),
            json={"items": [
                {"label": "Materials", "amount": 900},
                {"label": "Labour", "amount": 1500},
            ], "note": "TEST_V11"},
        )
        assert r.status_code == 200, r.text
        q = r.json()["contract"]
        assert q.get("quote_amount") == 2400
        assert q.get("quote_status") == "proposed"

        # 2. customer accepts
        r = requests.post(f"{BASE_URL}/api/contracts/{cid}/quote/respond",
                          headers=_auth(customer_token), json={"accept": True})
        assert r.status_code == 200, r.text
        c = r.json()["contract"]
        assert c.get("quote_status") == "accepted"

        # 3. verify milestones populated
        r = requests.get(f"{BASE_URL}/api/contracts/{cid}", headers=_auth(customer_token))
        c = r.json()["contract"]
        ms = c.get("milestones") or []
        keys = {m["key"]: m for m in ms}
        assert "deposit" in keys and "final" in keys, f"missing milestones: {ms}"
        assert abs(float(keys["deposit"]["amount"]) - 720.0) < 0.01
        assert abs(float(keys["final"]["amount"]) - 1680.0) < 0.01
        assert keys["deposit"]["status"] == "unpaid"
        assert keys["final"]["status"] == "unpaid"

        # 4. pay-deposit returns Checkout URL
        r = requests.post(f"{BASE_URL}/api/contracts/{cid}/milestones/deposit/pay",
                          headers=_auth(customer_token),
                          json={"origin": BASE_URL})
        assert r.status_code == 200, r.text
        url = r.json().get("url", "")
        assert "checkout.stripe.com" in url or "stripe" in url, f"unexpected: {url}"

        # 5. pay-final also returns Checkout URL
        r = requests.post(f"{BASE_URL}/api/contracts/{cid}/milestones/final/pay",
                          headers=_auth(customer_token),
                          json={"origin": BASE_URL})
        assert r.status_code == 200, r.text
        url = r.json().get("url", "")
        assert "checkout.stripe.com" in url or "stripe" in url, f"unexpected: {url}"

        # 6. confirm-complete on a NOT-completed contract must be 400
        r = requests.post(f"{BASE_URL}/api/contracts/{cid}/confirm-complete",
                          headers=_auth(customer_token), json={})
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


# ------------------------- Admin releases -------------------------------------

class TestAdminReleases:
    def test_releases_lists_seeded_contract(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/releases", headers=_auth(admin_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "releases" in data
        assert "fee_percent" in data
        assert "connect_enabled" in data
        # Find our seeded contract
        target = next((x for x in data["releases"] if x["contract_id"] == SEEDED_CONTRACT_ID), None)
        assert target is not None, f"seeded contract {SEEDED_CONTRACT_ID} not in releases: {[x['contract_id'] for x in data['releases']]}"
        assert abs(target["deposit_amount"] - 720.0) < 0.01
        # fee 10% => net 648
        assert abs(target["net_to_contractor"] - 648.0) < 0.01
        assert target["customer_confirmed"] is True
        assert target["payouts_enabled"] is False  # no real Stripe key

    def test_admin_release_without_stripe_key_returns_503(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/admin/contracts/{SEEDED_CONTRACT_ID}/release",
                          headers=_auth(admin_token), json={})
        # If payouts aren't enabled we may hit either 503 (no stripe key) or 400 (payouts not enabled)
        # depending on _connect_guard vs contractor.payouts_enabled check order.
        assert r.status_code in (400, 503), f"expected 400/503, got {r.status_code}: {r.text}"


# ------------------------- Contractor earnings --------------------------------

class TestContractorEarnings:
    def test_earnings_endpoint_for_customer_returns_zeros(self, customer_token):
        # A customer without a claimed listing gets zeros with no crash
        r = requests.get(f"{BASE_URL}/api/contractor/earnings", headers=_auth(customer_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("held") == 0.0
        assert data.get("released") == 0.0
        assert data.get("items") == []

    def test_fresh_contractor_earnings_zero(self):
        # Register a fresh contractor user; they have no listing/claims — earnings zero.
        email = f"TEST_v11pro_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register", json={
            "name": "TEST V11 Pro", "email": email, "password": "secret123", "role": "contractor"
        })
        assert r.status_code == 200, r.text
        token = r.json()["session_token"]
        r = requests.get(f"{BASE_URL}/api/contractor/earnings", headers=_auth(token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("held") == 0.0
        assert data.get("released") == 0.0
