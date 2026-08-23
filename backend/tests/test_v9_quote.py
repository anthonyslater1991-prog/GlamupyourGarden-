"""V9 quote flow tests: submit → accept/decline → deposit gating."""
import os
import time
import requests
import pytest

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")

CUSTOMER_EMAIL = "garden_test@example.com"
CUSTOMER_PASSWORD = "secret123"
ADMIN_EMAIL = "admin@glamgarden.app"
ADMIN_PASSWORD = "GlamAdmin2026!"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["session_token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def cust_tok():
    return _login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def contractor_id():
    r = requests.get(f"{BASE_URL}/api/contractors", timeout=30)
    assert r.status_code == 200
    data = r.json()
    items = data.get("contractors") or data.get("items") or data
    assert isinstance(items, list) and len(items) > 0
    return items[0]["id"]


@pytest.fixture(scope="module")
def contract_id(cust_tok, contractor_id):
    # Customer drafts a fresh contract
    body = {"contractor_id": contractor_id, "scope": "TEST_v9 quote flow", "price": "To be agreed"}
    r = requests.post(f"{BASE_URL}/api/contracts", headers=_hdr(cust_tok), json=body, timeout=30)
    assert r.status_code == 200, f"create contract failed: {r.status_code} {r.text}"
    cid = r.json()["contract"]["id"]
    assert cid.startswith("contract_")
    return cid


# --- Role gating ---

def test_customer_cannot_submit_quote(cust_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/quote",
        headers=_hdr(cust_tok),
        json={"items": [{"label": "Materials", "amount": 500}]},
        timeout=30,
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_deposit_blocked_before_quote_accepted(cust_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/deposit",
        headers=_hdr(cust_tok),
        json={"origin": BASE_URL},
        timeout=30,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    assert "quote" in r.text.lower()


# --- Contractor (admin acting) submits quote ---

def test_admin_submits_quote_updates_total_and_price(admin_tok, contract_id):
    items = [
        {"label": "Materials", "amount": 900},
        {"label": "Labour", "amount": 1500},
    ]
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/quote",
        headers=_hdr(admin_tok),
        json={"items": items, "note": "TEST_v9 quote note"},
        timeout=30,
    )
    assert r.status_code == 200, f"submit quote failed: {r.status_code} {r.text}"
    c = r.json()["contract"]
    assert c["quote_status"] == "proposed"
    assert c["quote_amount"] == 2400
    assert c["price"] == "£2,400"
    assert len(c["quote_items"]) == 2
    assert c["quote_note"] == "TEST_v9 quote note"


# --- Customer declines then admin re-submits ---

def test_customer_declines_quote(cust_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/quote/respond",
        headers=_hdr(cust_tok),
        json={"accept": False},
        timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["contract"]["quote_status"] == "declined"


def test_deposit_still_blocked_after_decline(cust_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/deposit",
        headers=_hdr(cust_tok),
        json={"origin": BASE_URL},
        timeout=30,
    )
    assert r.status_code == 400


def test_admin_can_update_quote_after_decline(admin_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/quote",
        headers=_hdr(admin_tok),
        json={"items": [{"label": "Materials", "amount": 900}, {"label": "Labour", "amount": 1500}], "note": "TEST_v9 revised"},
        timeout=30,
    )
    assert r.status_code == 200
    c = r.json()["contract"]
    assert c["quote_status"] == "proposed"
    assert c["quote_amount"] == 2400


# --- Contractor cannot accept the quote ---

def test_admin_cannot_accept_own_quote(admin_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/quote/respond",
        headers=_hdr(admin_tok),
        json={"accept": True},
        timeout=30,
    )
    assert r.status_code == 403


# --- Customer accepts quote → deposit unlocks ---

def test_customer_accepts_quote(cust_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/quote/respond",
        headers=_hdr(cust_tok),
        json={"accept": True},
        timeout=30,
    )
    assert r.status_code == 200
    c = r.json()["contract"]
    assert c["quote_status"] == "accepted"
    assert c.get("quote_decided_at")


def test_deposit_creates_stripe_session_after_accept(cust_tok, contract_id):
    r = requests.post(
        f"{BASE_URL}/api/contracts/{contract_id}/deposit",
        headers=_hdr(cust_tok),
        json={"origin": BASE_URL},
        timeout=45,
    )
    assert r.status_code == 200, f"deposit failed: {r.status_code} {r.text}"
    data = r.json()
    assert "url" in data
    assert data["url"].startswith("https://checkout.stripe.com/")
    assert data.get("amount") == 720.0  # 30% of 2400


def test_get_contract_persists_quote_state(cust_tok, contract_id):
    r = requests.get(f"{BASE_URL}/api/contracts/{contract_id}", headers=_hdr(cust_tok), timeout=30)
    assert r.status_code == 200
    c = r.json()["contract"] if "contract" in r.json() else r.json()
    assert c["quote_status"] == "accepted"
    assert c["quote_amount"] == 2400
    assert c["price"] == "£2,400"
    assert len(c["quote_items"]) == 2
