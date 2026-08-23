"""V8 backend tests: Contractor Accounts (claim/approve), Contract PDF, Deposit Payments (Stripe),
Review Reminders.

Endpoints under test:
- POST /api/auth/register {role: contractor}
- POST /api/contractors/{id}/claim (contractor only) + GET /api/my-contractor
- GET /api/admin/claims + POST /api/admin/claims/{id}/action
- PUT /api/contractors/{id}/profile (claimed contractor)
- POST /api/contractors/{id}/reviews/{rid}/reply
- GET /api/contracts/{id}/pdf (returns application/pdf, ?token= supported)
- POST /api/contracts/{id}/deposit -> Stripe Checkout session
- GET /api/payments/status/{session_id}
- GET /api/reminders + POST /api/contracts/{id}/dismiss-review
"""
import os
import uuid
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path("/app/frontend/.env"))

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = BASE_URL + "/api"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d["session_token"], "user": d["user"]}


def _register(email, password, role="customer", name="Tester"):
    r = requests.post(f"{API}/auth/register",
                      json={"name": name, "email": email, "password": password, "role": role},
                      timeout=30)
    assert r.status_code == 200, f"register {email}: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d["session_token"], "user": d["user"]}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def customer():
    return _login("garden_test@example.com", "secret123")


@pytest.fixture(scope="module")
def admin():
    return _login("admin@glamgarden.app", "GlamAdmin2026!")


@pytest.fixture(scope="module")
def fresh_contractor():
    """Registers a brand new contractor account (role=contractor)."""
    email = f"testcontractor_{uuid.uuid4().hex[:8]}@example.com"
    return _register(email, "secret123", role="contractor", name="TEST_v8 Contractor")


@pytest.fixture(scope="module")
def contractor_id(customer):
    r = requests.get(f"{API}/contractors", headers=_h(customer["token"]), timeout=15)
    assert r.status_code == 200, r.text
    contractors = r.json()["contractors"]
    # pick one that is not currently approved/claimed by another
    unclaimed = [c for c in contractors if c.get("claim_status") != "approved"]
    assert unclaimed, "Need at least one non-approved listing"
    return unclaimed[0]["id"]


@pytest.fixture(scope="module")
def claimed_listing(fresh_contractor, admin, contractor_id):
    """Contractor claims a listing, then admin approves it. Returns contractor_id.
    Idempotent — handles the case where prior tests already advanced the claim state."""
    # contractor claims
    r = requests.post(f"{API}/contractors/{contractor_id}/claim",
                      headers=_h(fresh_contractor["token"]), timeout=15)
    assert r.status_code == 200, r.text
    status = r.json()["claim_status"]
    assert status in ("pending", "approved")

    # admin approves if still pending
    if status == "pending":
        r = requests.post(f"{API}/admin/claims/{contractor_id}/action",
                          json={"action": "approve"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200, r.text
    # confirm final state
    r = requests.get(f"{API}/my-contractor",
                     headers=_h(fresh_contractor["token"]), timeout=15)
    assert r.status_code == 200
    assert r.json().get("contractor") and r.json()["contractor"]["id"] == contractor_id
    return contractor_id


# ---------------------------------------------------------------------------
# Feature: Contractor claim + admin approval
# ---------------------------------------------------------------------------
class TestContractorClaim:
    def test_customer_cannot_claim(self, customer, contractor_id):
        r = requests.post(f"{API}/contractors/{contractor_id}/claim",
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_contractor_can_claim_pending(self, fresh_contractor, contractor_id):
        r = requests.post(f"{API}/contractors/{contractor_id}/claim",
                          headers=_h(fresh_contractor["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["claim_status"] == "pending"

    def test_my_contractor_shows_pending(self, fresh_contractor, contractor_id):
        r = requests.get(f"{API}/my-contractor",
                         headers=_h(fresh_contractor["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        # pending block should reflect the just-claimed listing
        assert d.get("pending") is not None
        assert d["pending"]["id"] == contractor_id

    def test_admin_lists_pending_claim(self, admin, contractor_id):
        r = requests.get(f"{API}/admin/claims", headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()["claims"]]
        assert contractor_id in ids

    def test_admin_approves_claim(self, admin, contractor_id, fresh_contractor):
        r = requests.post(f"{API}/admin/claims/{contractor_id}/action",
                          json={"action": "approve"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        c = r.json()["contractor"]
        assert c["claim_status"] == "approved"
        assert c["claimed_by"] == fresh_contractor["user"]["user_id"]

    def test_my_contractor_shows_approved(self, fresh_contractor, contractor_id):
        r = requests.get(f"{API}/my-contractor",
                         headers=_h(fresh_contractor["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("contractor") is not None
        assert d["contractor"]["id"] == contractor_id
        assert d["contractor"]["claim_status"] == "approved"

    def test_contractor_updates_profile(self, fresh_contractor, contractor_id):
        new_tag = f"TEST_v8 tagline {uuid.uuid4().hex[:6]}"
        r = requests.put(f"{API}/contractors/{contractor_id}/profile",
                         json={"tagline": new_tag, "coverage_miles": 25},
                         headers=_h(fresh_contractor["token"]), timeout=15)
        assert r.status_code == 200
        c = r.json()["contractor"]
        assert c.get("tagline") == new_tag
        assert c.get("coverage_miles") == 25

    def test_other_contractor_cannot_edit(self, contractor_id):
        # brand-new contractor with no claim
        other = _register(f"other_{uuid.uuid4().hex[:8]}@example.com", "secret123",
                          role="contractor", name="Other Pro")
        r = requests.put(f"{API}/contractors/{contractor_id}/profile",
                         json={"tagline": "hax"},
                         headers=_h(other["token"]), timeout=15)
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Feature: Contract PDF
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def signed_contract(customer, admin, claimed_listing):
    """Create a contract on the claimed listing, both parties sign, return id."""
    r = requests.post(f"{API}/contracts",
                      json={"contractor_id": claimed_listing,
                            "price": "£2400",
                            "notes": "TEST_v8 signed contract"},
                      headers=_h(customer["token"]), timeout=20)
    assert r.status_code == 200, r.text
    cid = r.json()["contract"]["id"]
    # customer sign
    r1 = requests.post(f"{API}/contracts/{cid}/sign",
                       json={"full_name": "Garden Test", "agree": True},
                       headers=_h(customer["token"]), timeout=15)
    assert r1.status_code == 200
    # contractor (admin) sign -> active
    r2 = requests.post(f"{API}/contracts/{cid}/sign",
                       json={"full_name": "Admin Signer", "agree": True},
                       headers=_h(admin["token"]), timeout=15)
    assert r2.status_code == 200
    assert r2.json()["contract"]["status"] == "active"
    return cid


class TestContractPDF:
    def test_pdf_returns_application_pdf_with_bearer(self, customer, signed_contract):
        r = requests.get(f"{API}/contracts/{signed_contract}/pdf",
                         headers=_h(customer["token"]), timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        # PDF magic bytes
        assert r.content[:4] == b"%PDF", "response is not a real PDF"
        assert len(r.content) > 1000, "PDF too small to be real"

    def test_pdf_returns_application_pdf_with_query_token(self, customer, signed_contract):
        # ?token= flow (used by expo web link)
        r = requests.get(f"{API}/contracts/{signed_contract}/pdf",
                         params={"token": customer["token"]}, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_pdf_unauthorised_gets_401_or_403(self, signed_contract):
        r = requests.get(f"{API}/contracts/{signed_contract}/pdf", timeout=15)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Feature: Deposit Payments (Stripe test mode)
# ---------------------------------------------------------------------------
class TestDeposit:
    def test_deposit_creates_stripe_session(self, customer, signed_contract):
        r = requests.post(f"{API}/contracts/{signed_contract}/deposit",
                          json={"origin": BASE_URL},
                          headers=_h(customer["token"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["session_id"], "session_id missing"
        assert d["url"].startswith("https://checkout.stripe.com/"), f"unexpected url {d['url']}"
        # 30% of £2400 = 720
        assert abs(d["amount"] - 720.0) < 0.01, f"expected £720 deposit, got {d['amount']}"

    def test_payment_status_endpoint(self, customer, signed_contract):
        # create a fresh session then poll status
        r = requests.post(f"{API}/contracts/{signed_contract}/deposit",
                          json={"origin": BASE_URL},
                          headers=_h(customer["token"]), timeout=30)
        # a fresh session might 400 if already-paid (idempotency); if so re-create not possible.
        if r.status_code == 400 and "already paid" in r.text.lower():
            pytest.skip("deposit already paid on this contract in a prior run")
        assert r.status_code == 200, r.text
        sess = r.json()["session_id"]
        rs = requests.get(f"{API}/payments/status/{sess}",
                          headers=_h(customer["token"]), timeout=30)
        assert rs.status_code == 200, rs.text
        body = rs.json()
        assert body["payment_status"] in ("unpaid", "paid", "no_payment_required")
        assert body["status"] in ("open", "complete", "expired")

    def test_deposit_requires_both_signed(self, customer, claimed_listing):
        # unsigned contract
        r = requests.post(f"{API}/contracts",
                          json={"contractor_id": claimed_listing, "price": "£1000"},
                          headers=_h(customer["token"]), timeout=20)
        cid = r.json()["contract"]["id"]
        r2 = requests.post(f"{API}/contracts/{cid}/deposit",
                           json={"origin": BASE_URL},
                           headers=_h(customer["token"]), timeout=15)
        assert r2.status_code == 400
        assert "sign" in r2.text.lower()

    def test_only_customer_can_pay(self, admin, signed_contract):
        r = requests.post(f"{API}/contracts/{signed_contract}/deposit",
                          json={"origin": BASE_URL},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Feature: Review Reminders
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def completed_contract(customer, admin, claimed_listing):
    """Create + sign + advance all stages so status=completed."""
    r = requests.post(f"{API}/contracts",
                      json={"contractor_id": claimed_listing,
                            "price": "£999",
                            "notes": "TEST_v8 completed"},
                      headers=_h(customer["token"]), timeout=20)
    cid = r.json()["contract"]["id"]
    requests.post(f"{API}/contracts/{cid}/sign",
                  json={"full_name": "Garden Test", "agree": True},
                  headers=_h(customer["token"]))
    requests.post(f"{API}/contracts/{cid}/sign",
                  json={"full_name": "Admin", "agree": True},
                  headers=_h(admin["token"]))
    # advance to last stage
    r = requests.post(f"{API}/contracts/{cid}/stage",
                      json={"stage_index": 4, "note": "TEST_v8 done"},
                      headers=_h(admin["token"]), timeout=15)
    assert r.status_code == 200
    assert r.json()["contract"]["status"] == "completed"
    return cid


class TestReviewReminders:
    def test_reminders_include_completed_contract(self, customer, completed_contract, claimed_listing):
        r = requests.get(f"{API}/reminders", headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        ids = [p["contract_id"] for p in d["review_prompts"]]
        assert completed_contract in ids
        # count matches list length
        assert d["count"] == len(d["review_prompts"])
        # contains contractor_id
        prompt = next(p for p in d["review_prompts"] if p["contract_id"] == completed_contract)
        assert prompt["contractor_id"] == claimed_listing

    def test_dismiss_review_clears_reminder(self, customer, completed_contract):
        r = requests.post(f"{API}/contracts/{completed_contract}/dismiss-review",
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200
        # verify reminder removed
        r2 = requests.get(f"{API}/reminders", headers=_h(customer["token"]), timeout=15)
        assert r2.status_code == 200
        ids = [p["contract_id"] for p in r2.json()["review_prompts"]]
        assert completed_contract not in ids

    def test_reminders_requires_auth(self):
        r = requests.get(f"{API}/reminders", timeout=15)
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# Feature: contractor reply to review (part of contractor accounts)
# ---------------------------------------------------------------------------
class TestReviewReply:
    def test_contractor_can_reply(self, customer, fresh_contractor, claimed_listing):
        # customer leaves a review
        r = requests.post(f"{API}/contractors/{claimed_listing}/reviews",
                          json={"rating": 5, "text": "TEST_v8 great job"},
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200, r.text
        review = r.json()["review"]
        rid = review["id"]

        # contractor replies
        r2 = requests.post(f"{API}/contractors/{claimed_listing}/reviews/{rid}/reply",
                           json={"text": "TEST_v8 thanks for the kind words"},
                           headers=_h(fresh_contractor["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["review"]["reply"] == "TEST_v8 thanks for the kind words"
