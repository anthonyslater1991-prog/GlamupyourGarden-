"""V7 backend tests: Automated contractor contracts.
Covers:
- POST /api/contracts auto-draft (9 clauses, 5 stages, status=draft, prefilled)
- GET /api/contracts (customer sees own; admin/contractor sees all)
- GET /api/contracts/{id} access control (403 for other customer)
- PUT /api/contracts/{id} edits reset signatures/status=draft; 400 once both signed
- POST /api/contracts/{id}/sign customer + contractor(admin), status becomes active + progress_index=1
- POST /api/contracts/{id}/stage only contractor/admin; requires both signed; last stage -> completed; customer 403
- POST /api/contracts/{id}/messages persists with sender_role
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or
            "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")
API = BASE_URL + "/api"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d["session_token"], "user": d["user"]}


def _login_or_register(email, password, name="Tester"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 401:
        r = requests.post(f"{API}/auth/register", json={"name": name, "email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d["session_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def customer():
    return _login("garden_test@example.com", "secret123")


@pytest.fixture(scope="module")
def admin():
    return _login("admin@glamgarden.app", "GlamAdmin2026!")


@pytest.fixture(scope="module")
def other_customer():
    # Any other non-admin customer - bella has role customer per test_credentials.md
    return _login_or_register("bella@example.com", "secret123", name="Bella")


@pytest.fixture(scope="module")
def contractor_id(customer):
    r = requests.get(f"{API}/contractors", headers=_h(customer["token"]), timeout=15)
    assert r.status_code == 200, r.text
    contractors = r.json()["contractors"]
    assert len(contractors) >= 1, "No contractors in directory to test with"
    return contractors[0]["id"]


@pytest.fixture(scope="module")
def contract_id(customer, contractor_id):
    """One shared contract used across the flow."""
    r = requests.post(f"{API}/contracts",
                      json={"contractor_id": contractor_id,
                            "price": "£1200",
                            "notes": "TEST_v7 shared"},
                      headers=_h(customer["token"]), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["contract"]["id"]


class TestContractDraft:
    def test_create_contract_auto_drafts_with_clauses_and_stages(self, customer, contractor_id):
        r = requests.post(f"{API}/contracts",
                          json={"contractor_id": contractor_id,
                                "price": "£1200",
                                "notes": "TEST_v7 auto-draft"},
                          headers=_h(customer["token"]), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        c = data["contract"]
        clauses = data["clauses"]
        assert c["status"] == "draft"
        assert c["contractor_id"] == contractor_id
        assert c["customer_id"] == customer["user"]["user_id"]
        assert c["customer_signed"] is False and c["contractor_signed"] is False
        assert c["price"] == "£1200"
        assert c["scope"], "scope must be pre-filled"
        assert c["deposit_percent"] == 30
        assert c["payment_terms"]
        assert c["warranty"]
        # standard clauses
        assert isinstance(clauses, list) and len(clauses) == 9
        assert all("label" in cl and "text" in cl for cl in clauses)
        # 5 job stages, none done
        assert isinstance(c["stages"], list) and len(c["stages"]) == 5
        assert all(s["done"] is False for s in c["stages"])
        assert c["progress_index"] == 0

    def test_create_contract_missing_contractor_404(self, customer):
        r = requests.post(f"{API}/contracts", json={"contractor_id": "does-not-exist"},
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 404, r.text

    def test_create_requires_auth(self, contractor_id):
        r = requests.post(f"{API}/contracts", json={"contractor_id": contractor_id}, timeout=15)
        assert r.status_code == 401


class TestContractListingAndAccess:
    def test_customer_lists_only_own(self, customer, contract_id):
        r = requests.get(f"{API}/contracts", headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200, r.text
        contracts = r.json()["contracts"]
        assert all(c["customer_id"] == customer["user"]["user_id"] for c in contracts)
        assert any(c["id"] == contract_id for c in contracts)

    def test_admin_lists_all(self, admin, contract_id):
        r = requests.get(f"{API}/contracts", headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200, r.text
        contracts = r.json()["contracts"]
        assert any(c["id"] == contract_id for c in contracts)

    def test_get_contract_by_owner_ok(self, customer, contract_id):
        r = requests.get(f"{API}/contracts/{contract_id}", headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["contract"]["id"] == contract_id
        assert len(r.json()["clauses"]) == 9

    def test_get_contract_by_admin_ok(self, admin, contract_id):
        r = requests.get(f"{API}/contracts/{contract_id}", headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200

    def test_get_contract_by_other_customer_forbidden(self, other_customer, contract_id):
        # other_customer must not be admin/contractor; verify role first
        role = other_customer["user"].get("role")
        if role in ("admin", "contractor"):
            pytest.skip(f"bella has role {role}, cannot test 403 path")
        r = requests.get(f"{API}/contracts/{contract_id}",
                         headers=_h(other_customer["token"]), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_get_nonexistent_contract_404(self, customer):
        r = requests.get(f"{API}/contracts/nope-{uuid.uuid4().hex[:6]}",
                         headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 404


class TestContractEditAndSign:
    def test_edit_resets_signatures_and_returns_draft(self, customer, contract_id):
        # first customer partially signs
        r = requests.post(f"{API}/contracts/{contract_id}/sign",
                          json={"full_name": "Garden Test", "agree": True},
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["contract"]["customer_signed"] is True
        assert r.json()["contract"]["status"] == "awaiting_signatures"
        # now edit -> must reset customer signature
        r = requests.put(f"{API}/contracts/{contract_id}",
                         json={"price": "£1500", "deposit_percent": 40},
                         headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200
        c = r.json()["contract"]
        assert c["price"] == "£1500"
        assert c["deposit_percent"] == 40
        assert c["status"] == "draft"
        assert c["customer_signed"] is False
        assert c["contractor_signed"] is False

    def test_customer_signs_then_admin_signs_activates(self, customer, admin, contract_id):
        r1 = requests.post(f"{API}/contracts/{contract_id}/sign",
                           json={"full_name": "Garden Test", "agree": True},
                           headers=_h(customer["token"]), timeout=15)
        assert r1.status_code == 200
        c1 = r1.json()["contract"]
        assert c1["customer_signed"] is True
        assert c1["status"] == "awaiting_signatures"

        r2 = requests.post(f"{API}/contracts/{contract_id}/sign",
                           json={"full_name": "Admin Signer", "agree": True},
                           headers=_h(admin["token"]), timeout=15)
        assert r2.status_code == 200
        c2 = r2.json()["contract"]
        assert c2["contractor_signed"] is True
        assert c2["status"] == "active"
        # auto stage 1
        assert c2["progress_index"] == 1
        assert c2["stages"][0]["done"] is True

    def test_edit_after_both_signed_returns_400(self, customer, contract_id):
        r = requests.put(f"{API}/contracts/{contract_id}",
                         json={"price": "£2000"},
                         headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 400, r.text

    def test_sign_requires_full_name(self, customer):
        # Create a fresh contract for this test
        rc = requests.post(f"{API}/contracts",
                           json={"contractor_id": (requests.get(f"{API}/contractors", headers=_h(customer["token"])).json()["contractors"][0]["id"])},
                           headers=_h(customer["token"]), timeout=15)
        assert rc.status_code == 200
        cid = rc.json()["contract"]["id"]
        r = requests.post(f"{API}/contracts/{cid}/sign",
                          json={"full_name": "", "agree": True},
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 400


class TestStageProgress:
    def test_customer_cannot_update_stage(self, customer, contract_id):
        r = requests.post(f"{API}/contracts/{contract_id}/stage",
                          json={"stage_index": 2, "note": "TEST_v7 cust cannot"},
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_admin_updates_middle_stage(self, admin, contract_id):
        r = requests.post(f"{API}/contracts/{contract_id}/stage",
                          json={"stage_index": 2, "note": "TEST_v7 materials ordered"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        c = r.json()["contract"]
        assert c["progress_index"] == 3  # idx+1
        assert c["status"] == "active"
        assert c["stages"][0]["done"] is True
        assert c["stages"][2]["done"] is True
        assert c["stages"][2]["note"] == "TEST_v7 materials ordered"
        assert c["stages"][3]["done"] is False

    def test_admin_marks_last_stage_completes_contract(self, admin, contract_id):
        r = requests.post(f"{API}/contracts/{contract_id}/stage",
                          json={"stage_index": 4, "note": "TEST_v7 done"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        c = r.json()["contract"]
        assert c["progress_index"] == 5
        assert c["status"] == "completed"
        assert all(s["done"] for s in c["stages"])

    def test_stage_requires_both_signed(self, customer, admin):
        # Fresh unsigned contract
        cid_r = requests.get(f"{API}/contractors", headers=_h(customer["token"])).json()["contractors"][0]["id"]
        rc = requests.post(f"{API}/contracts", json={"contractor_id": cid_r},
                           headers=_h(customer["token"]), timeout=15)
        assert rc.status_code == 200
        cid = rc.json()["contract"]["id"]
        r = requests.post(f"{API}/contracts/{cid}/stage", json={"stage_index": 1},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 400

    def test_stage_index_out_of_range(self, admin, contract_id):
        r = requests.post(f"{API}/contracts/{contract_id}/stage",
                          json={"stage_index": 99},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 400


class TestContractMessages:
    def test_customer_can_post_message_with_role(self, customer, contract_id):
        r = requests.post(f"{API}/contracts/{contract_id}/messages",
                          json={"text": "TEST_v7 hello from customer"},
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200
        m = r.json()["message"]
        assert m["sender_role"] == "customer"
        assert m["text"] == "TEST_v7 hello from customer"

    def test_admin_posts_as_contractor_role(self, admin, contract_id):
        r = requests.post(f"{API}/contracts/{contract_id}/messages",
                          json={"text": "TEST_v7 hello from contractor"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        m = r.json()["message"]
        assert m["sender_role"] == "contractor"

    def test_messages_returned_in_get(self, customer, contract_id):
        r = requests.get(f"{API}/contracts/{contract_id}", headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 200
        msgs = r.json()["contract"].get("messages", [])
        assert len(msgs) >= 2
        roles = {m["sender_role"] for m in msgs}
        assert "customer" in roles and "contractor" in roles

    def test_empty_message_rejected(self, customer, contract_id):
        r = requests.post(f"{API}/contracts/{contract_id}/messages",
                          json={"text": "   "},
                          headers=_h(customer["token"]), timeout=15)
        assert r.status_code == 400
