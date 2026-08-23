"""V3 backend tests: unread badge, block/report, photo DMs/rooms,
registration with address, custom polls, maps + distances."""
import os
import time
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    "https://outdoor-uplift.preview.emergentagent.com"
API = BASE_URL + "/api"


def _login_or_register(email, password, name="Tester", **extra):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 401:
        body = {"name": name, "email": email, "password": password, **extra}
        r = requests.post(f"{API}/auth/register", json=body, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def test_user():
    """garden_test@example.com with postcode M1 1AE."""
    data = _login_or_register("garden_test@example.com", "secret123",
                              name="Garden Test", postcode="M1 1AE", phone="07000000000")
    tok = data["session_token"]
    uid = data["user"]["user_id"]
    # ensure postcode+phone set
    requests.put(f"{API}/auth/profile",
                 json={"postcode": "M1 1AE", "phone": "07000000000"},
                 headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    return {"token": tok, "user_id": uid, "email": "garden_test@example.com"}


@pytest.fixture(scope="module")
def bella():
    data = _login_or_register("bella@example.com", "secret123", name="Bella")
    return {"token": data["session_token"], "user_id": data["user"]["user_id"]}


@pytest.fixture(scope="module")
def cara():
    data = _login_or_register("cara@example.com", "secret123", name="Cara",
                              postcode="LS1 4DY", phone="07111222333")
    tok = data["session_token"]
    requests.put(f"{API}/auth/profile",
                 json={"postcode": "LS1 4DY", "phone": "07111222333"},
                 headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    return {"token": tok, "user_id": data["user"]["user_id"]}


@pytest.fixture(scope="module")
def admin():
    data = _login_or_register("admin@glamgarden.app", "GlamAdmin2026!")
    return {"token": data["session_token"]}


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Registration + profile with address ----------
class TestRegistrationAddress:
    def test_public_user_returns_new_fields(self, test_user):
        r = requests.get(f"{API}/auth/me", headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["postcode"] == "M1 1AE"
        assert u["phone"] == "07000000000"
        assert "address" in u

    def test_profile_update_uppercases_postcode(self, test_user):
        r = requests.put(f"{API}/auth/profile",
                         json={"postcode": "m1 1ae", "address": "10 Test St"},
                         headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["postcode"] == "M1 1AE"
        assert u["address"] == "10 Test St"

    def test_register_with_address_fields(self):
        email = f"TEST_reg_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register",
                          json={"name": "TEST Reg", "email": email, "password": "secret123",
                                "phone": "07000000001", "address": "1 High St", "postcode": "sw1a 1aa"},
                          timeout=30)
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["postcode"] == "SW1A 1AA"
        assert u["phone"] == "07000000001"
        assert u["address"] == "1 High St"


# ---------- Unread badge ----------
class TestUnreadBadge:
    def test_unread_flow(self, test_user, bella):
        # Baseline unread for bella
        r = requests.get(f"{API}/unread", headers=_h(bella["token"]), timeout=15)
        assert r.status_code == 200
        base = r.json()["count"]

        # send DM garden_test -> bella
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": bella["user_id"], "text": "TEST_ unread ping"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200

        r = requests.get(f"{API}/unread", headers=_h(bella["token"]), timeout=15)
        assert r.json()["count"] >= base + 1

        # Bella opens the thread -> should mark read
        r = requests.get(f"{API}/messages/{test_user['user_id']}", headers=_h(bella["token"]), timeout=15)
        assert r.status_code == 200

        r = requests.get(f"{API}/unread", headers=_h(bella["token"]), timeout=15)
        # after opening, unread from this sender is cleared
        assert r.json()["count"] <= base


# ---------- Photo messages ----------
class TestPhotoMessages:
    def test_dm_image_only_ok(self, test_user, bella):
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": bella["user_id"], "text": "",
                                "image_path": "glam-up-your-garden/fake.jpg"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["message"]["image_path"].endswith("fake.jpg")

    def test_dm_empty_text_and_no_image_400(self, test_user, bella):
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": bella["user_id"], "text": "  "},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 400

    def test_room_image_only_ok(self, test_user):
        r = requests.post(f"{API}/rooms/general/messages",
                          json={"text": "", "image_path": "glam-up-your-garden/room.jpg"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["message"]["image_path"].endswith("room.jpg")

    def test_room_empty_400(self, test_user):
        r = requests.post(f"{API}/rooms/general/messages",
                          json={"text": ""},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 400


# ---------- Block / Report ----------
class TestBlockReport:
    def test_block_prevents_dm_and_filters_lists(self, test_user, cara):
        # ensure not blocked (cleanup pre)
        requests.post(f"{API}/unblock",
                      json={"user_id": cara["user_id"]},
                      headers=_h(test_user["token"]), timeout=15)

        # baseline dm works both ways
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": cara["user_id"], "text": "TEST_ pre-block"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200

        # test_user blocks cara
        r = requests.post(f"{API}/block",
                          json={"user_id": cara["user_id"]},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200

        # test_user -> cara now 403
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": cara["user_id"], "text": "TEST_ blocked send"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 403

        # cara -> test_user also 403 (symmetric block)
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": test_user["user_id"], "text": "TEST_ blocked reverse"},
                          headers=_h(cara["token"]), timeout=15)
        assert r.status_code == 403

        # cara hidden from test_user's members list
        r = requests.get(f"{API}/members", headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        member_ids = [m["user_id"] for m in r.json()["members"]]
        assert cara["user_id"] not in member_ids

        # conversations shouldn't include cara
        r = requests.get(f"{API}/conversations", headers=_h(test_user["token"]), timeout=15)
        conv_ids = [c["other_id"] for c in r.json()["conversations"]]
        assert cara["user_id"] not in conv_ids

        # blocks list has cara
        r = requests.get(f"{API}/blocks", headers=_h(test_user["token"]), timeout=15)
        assert cara["user_id"] in r.json()["blocked"]

        # room messages: post one from cara, ensure test_user doesn't see cara's msg
        marker = f"TEST_ cara room {uuid.uuid4().hex[:6]}"
        requests.post(f"{API}/rooms/general/messages",
                      json={"text": marker},
                      headers=_h(cara["token"]), timeout=15)
        r = requests.get(f"{API}/rooms/general/messages", headers=_h(test_user["token"]), timeout=15)
        texts = [m["text"] for m in r.json()["messages"]]
        assert marker not in texts

        # unblock restores
        r = requests.post(f"{API}/unblock",
                          json={"user_id": cara["user_id"]},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": cara["user_id"], "text": "TEST_ post-unblock"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200

    def test_report_stored(self, test_user, cara, admin):
        r = requests.post(f"{API}/report",
                          json={"reported_id": cara["user_id"], "reason": "spam",
                                "context": "TEST_ test context"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        r = requests.get(f"{API}/admin/reports", headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        reports = r.json()["reports"]
        assert any(rp.get("reason") == "spam" and rp.get("context") == "TEST_ test context" for rp in reports)

    def test_admin_reports_forbidden_for_customer(self, test_user):
        r = requests.get(f"{API}/admin/reports", headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 403


# ---------- Custom polls ----------
class TestCustomPolls:
    def test_create_and_activate_and_delete(self, admin):
        q = f"TEST_ poll {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/admin/polls",
                          json={"question": q,
                                "options": ["Option A", "Option B", "Option C"],
                                "activate": True},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        poll = r.json()["poll"]
        assert poll["active"] is True
        active_id = poll["id"]

        # only one active
        r = requests.get(f"{API}/admin/polls", headers=_h(admin["token"]), timeout=15)
        actives = [p for p in r.json()["polls"] if p.get("active")]
        assert len(actives) == 1
        assert actives[0]["id"] == active_id

        # cannot delete active
        r = requests.delete(f"{API}/admin/polls/{active_id}", headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 400

        # create a second (non-active) poll
        r = requests.post(f"{API}/admin/polls",
                          json={"question": f"TEST_ inactive {uuid.uuid4().hex[:6]}",
                                "options": ["Yes", "No"], "activate": False},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        inactive_id = r.json()["poll"]["id"]

        # delete non-active OK
        r = requests.delete(f"{API}/admin/polls/{inactive_id}", headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200

        # cleanup: activate the seeded poll again so tests don't leave TEST_ active
        r = requests.get(f"{API}/admin/polls", headers=_h(admin["token"]), timeout=15)
        polls = r.json()["polls"]
        seeded = next((p for p in polls if not p["question"].startswith("TEST_")), None)
        if seeded:
            requests.post(f"{API}/admin/polls/{seeded['id']}/activate",
                          headers=_h(admin["token"]), timeout=15)
            # now delete TEST_ active poll
            requests.delete(f"{API}/admin/polls/{active_id}", headers=_h(admin["token"]), timeout=15)

    def test_customer_cannot_create_poll(self, test_user):
        r = requests.post(f"{API}/admin/polls",
                          json={"question": "hax", "options": ["a", "b"]},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 403


# ---------- Maps ----------
class TestMaps:
    def test_map_contractors_with_distances(self, test_user):
        r = requests.get(f"{API}/map/contractors", headers=_h(test_user["token"]), timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert data.get("me") is not None, "user coord should resolve from M1 1AE"
        cons = data["contractors"]
        assert len(cons) >= 4
        # first should have distance, and Manchester (M1) should be nearest to M1 1AE
        first = cons[0]
        assert first["distance_km"] is not None
        # Manchester contractor is expected to be nearest
        assert "Manchester" in (first.get("location") or "") or first["distance_km"] < 5
        assert data.get("map_url", "").startswith("https://staticmap.openstreetmap.de")

    def test_admin_map(self, admin, test_user):
        # ensure test_user has a project so they show up as a customer
        r = requests.get(f"{API}/projects", headers=_h(test_user["token"]), timeout=15)
        if not r.json().get("projects"):
            requests.post(f"{API}/projects",
                          json={"title": "TEST_ seed"},
                          headers=_h(test_user["token"]), timeout=15)
        r = requests.get(f"{API}/admin/map", headers=_h(admin["token"]), timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data.get("customers"), list)
        assert isinstance(data.get("contractors"), list)
        assert len(data["contractors"]) >= 4
        assert data.get("map_url", "").startswith("https://staticmap.openstreetmap.de")

    def test_admin_map_forbidden_for_customer(self, test_user):
        r = requests.get(f"{API}/admin/map", headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 403
