"""V5 backend tests: personalised redesign (wishlist -> B&Q pins first),
wall reactions + comments, project gallery add, DM read receipts, /map/contractors
returns coverage_miles + reachable + distance_km."""
import os
import uuid
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    "https://outdoor-uplift.preview.emergentagent.com"
API = BASE_URL + "/api"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _login_or_register(email, password, name="Tester", **extra):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 401:
        body = {"name": name, "email": email, "password": password, **extra}
        r = requests.post(f"{API}/auth/register", json=body, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def test_user():
    data = _login_or_register("garden_test@example.com", "secret123",
                              name="Garden Test", postcode="M1 1AE", phone="07000000000")
    tok = data["session_token"]
    requests.put(f"{API}/auth/profile",
                 json={"postcode": "M1 1AE"}, headers=_h(tok), timeout=15)
    return {"token": tok, "user_id": data["user"]["user_id"]}


@pytest.fixture(scope="module")
def cara():
    data = _login_or_register("cara@example.com", "secret123", name="Cara")
    return {"token": data["session_token"], "user_id": data["user"]["user_id"]}


# ---------- Wall reactions + comments ----------
class TestWallReactCommentGet:
    def test_react_increments_and_get_wall_returns_it(self, test_user):
        # create a post
        r = requests.post(f"{API}/wall",
                          json={"caption": f"TEST_ v5 wall {uuid.uuid4().hex[:6]}"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200, r.text
        post_id = r.json()["post"]["id"]

        # react with 🌿 twice
        for _ in range(2):
            rr = requests.post(f"{API}/wall/{post_id}/react",
                               json={"emoji": "🌿"},
                               headers=_h(test_user["token"]), timeout=15)
            assert rr.status_code == 200, rr.text
        # react with ❤️ once
        rr = requests.post(f"{API}/wall/{post_id}/react",
                           json={"emoji": "❤️"},
                           headers=_h(test_user["token"]), timeout=15)
        assert rr.status_code == 200

        # verify reactions dict via /wall
        r = requests.get(f"{API}/wall", timeout=15)
        assert r.status_code == 200
        posts = r.json()["posts"]
        this = next(p for p in posts if p["id"] == post_id)
        assert this["reactions"].get("🌿") == 2
        assert this["reactions"].get("❤️") == 1

    def test_empty_emoji_rejected(self, test_user):
        r = requests.post(f"{API}/wall",
                          json={"caption": f"TEST_ v5 wall {uuid.uuid4().hex[:6]}"},
                          headers=_h(test_user["token"]), timeout=15)
        post_id = r.json()["post"]["id"]
        r = requests.post(f"{API}/wall/{post_id}/react",
                          json={"emoji": ""},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 400

    def test_comment_appended_and_visible(self, test_user):
        r = requests.post(f"{API}/wall",
                          json={"caption": f"TEST_ v5 cmt {uuid.uuid4().hex[:6]}"},
                          headers=_h(test_user["token"]), timeout=15)
        post_id = r.json()["post"]["id"]

        text = f"TEST_ nice one {uuid.uuid4().hex[:6]} 🌿"
        r = requests.post(f"{API}/wall/{post_id}/comment",
                          json={"text": text},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["comment"]["text"] == text

        r = requests.get(f"{API}/wall", timeout=15)
        this = next(p for p in r.json()["posts"] if p["id"] == post_id)
        assert any(c["text"] == text for c in this["comments"])

    def test_empty_comment_rejected(self, test_user):
        r = requests.post(f"{API}/wall",
                          json={"caption": f"TEST_ v5 empty cmt {uuid.uuid4().hex[:6]}"},
                          headers=_h(test_user["token"]), timeout=15)
        post_id = r.json()["post"]["id"]
        r = requests.post(f"{API}/wall/{post_id}/comment",
                          json={"text": "   "},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 400


# ---------- DM read receipts ----------
class TestDMReadReceipts:
    def test_read_flag_flips_after_recipient_gets(self, test_user, cara):
        # test_user sends to cara
        text = f"TEST_ v5 read {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": cara["user_id"], "text": text},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200, r.text
        msg_id = r.json()["message"]["id"]
        assert r.json()["message"]["read"] is False

        # Before cara opens the thread, from test_user side, the message read=False
        r = requests.get(f"{API}/messages/{cara['user_id']}",
                         headers=_h(test_user["token"]), timeout=15)
        my_msg = next(m for m in r.json()["messages"] if m["id"] == msg_id)
        assert my_msg["read"] is False

        # cara opens the thread with test_user — this should mark read=True
        r = requests.get(f"{API}/messages/{test_user['user_id']}",
                         headers=_h(cara["token"]), timeout=15)
        assert r.status_code == 200

        # now test_user re-fetches and sees read=True (Seen)
        r = requests.get(f"{API}/messages/{cara['user_id']}",
                         headers=_h(test_user["token"]), timeout=15)
        my_msg = next(m for m in r.json()["messages"] if m["id"] == msg_id)
        assert my_msg["read"] is True


# ---------- Gallery add ----------
class TestProjectGallery:
    def test_add_and_persists_in_get_project(self, test_user):
        # ensure at least one project exists
        r = requests.get(f"{API}/projects", headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        projects = r.json()["projects"]
        if not projects:
            r = requests.post(f"{API}/projects",
                              json={"name": f"TEST_ v5 gallery {uuid.uuid4().hex[:6]}"},
                              headers=_h(test_user["token"]), timeout=15)
            assert r.status_code == 200
            pid = r.json()["project"]["id"]
        else:
            pid = projects[0]["id"]

        path = f"glam-up-your-garden/v5_gallery_{uuid.uuid4().hex[:8]}.jpg"
        r = requests.post(f"{API}/projects/{pid}/gallery",
                          json={"image_path": path, "note": "TEST_ v5"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200, r.text
        item_id = r.json()["item"]["id"]

        # GET verifies persistence
        r = requests.get(f"{API}/projects/{pid}", headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        gallery = r.json()["project"].get("gallery", [])
        matched = next((g for g in gallery if g["id"] == item_id), None)
        assert matched is not None
        assert matched["image_path"] == path


# ---------- /map/contractors coverage + reachable ----------
class TestMapContractorsCoverage:
    def test_returns_coverage_and_reachable(self, test_user):
        r = requests.get(f"{API}/map/contractors",
                         headers=_h(test_user["token"]), timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        cons = data["contractors"]
        assert len(cons) >= 4
        for c in cons:
            assert "coverage_miles" in c
            assert isinstance(c["coverage_miles"], int)
            assert "reachable" in c
            assert "distance_km" in c
        # Manchester contractor should be nearest & reachable
        nearest = cons[0]
        assert nearest["reachable"] is True
        assert nearest["distance_km"] is not None
        assert nearest["distance_km"] < 5.0


# ---------- Redesign with full filters + wishlist B&Q pins first ----------
class TestPersonalisedRedesign:
    def test_wishlist_pins_first_are_bq(self, test_user):
        # need a project with original_path — fetch existing project that has one, else skip
        r = requests.get(f"{API}/projects", headers=_h(test_user["token"]), timeout=15)
        projects = r.json()["projects"]
        target = next((p for p in projects if p.get("original_path")), None)
        if not target:
            pytest.skip("No project with an uploaded garden photo — skip (owner must upload).")

        payload = {
            "changes": ["Add a seating area", "Lush planting"],
            "style": "modern-tranquil",
            "garden_type": "small urban patio",
            "mood": "calm",
            "colour_scheme": "greens and cream",
            "ornaments": ["Solar lanterns", "Wooden pergola"],
            "must_haves": "Space for two chairs",
            "wishlist": ["Ego LM2130E-SP mower", "Weber Q1200 BBQ"],
            "notes": "TEST_ v5 personalisation"
        }
        r = requests.post(f"{API}/projects/{target['id']}/redesign",
                          json=payload, headers=_h(test_user["token"]), timeout=180)
        if r.status_code == 502:
            pytest.skip("AI image gen 502; retry manually.")
        assert r.status_code == 200, r.text
        design = r.json()["design"]
        hotspots = design["hotspots"]
        assert len(hotspots) >= 2
        # First two hotspots must be wishlist items with retailer B&Q
        assert hotspots[0]["name"] == "Ego LM2130E-SP mower"
        assert hotspots[0]["retailer"] == "B&Q"
        assert "diy.com" in hotspots[0]["url"]
        assert hotspots[1]["name"] == "Weber Q1200 BBQ"
        assert hotspots[1]["retailer"] == "B&Q"
        # persisted filters
        assert design["garden_type"] == "small urban patio"
        assert design["mood"] == "calm"
        assert design["colour_scheme"] == "greens and cream"
        assert design["ornaments"] == ["Solar lanterns", "Wooden pergola"]
        assert design["wishlist"] == ["Ego LM2130E-SP mower", "Weber Q1200 BBQ"]
