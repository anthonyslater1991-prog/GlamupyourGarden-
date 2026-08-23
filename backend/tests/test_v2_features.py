"""Backend tests for v2: messaging, rooms, admin dashboard."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outdoor-uplift.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def user_a_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "garden_test@example.com", "password": "secret123"})
    if r.status_code != 200:
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"name": "Garden Test", "email": "garden_test@example.com", "password": "secret123"})
    assert r.status_code == 200, r.text
    return r.json()["session_token"], r.json()["user"]["user_id"]


@pytest.fixture(scope="module")
def user_b_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "bella@example.com", "password": "secret123"})
    if r.status_code != 200:
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"name": "Bella Bloom", "email": "bella@example.com", "password": "secret123"})
    assert r.status_code == 200, r.text
    return r.json()["session_token"], r.json()["user"]["user_id"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@glamgarden.app", "password": "GlamAdmin2026!"})
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return r.json()["session_token"]


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


# --- Members list ---
class TestMembers:
    def test_members_excludes_self_and_admin(self, user_a_token, user_b_token):
        tok_a, uid_a = user_a_token
        tok_b, uid_b = user_b_token
        r = requests.get(f"{BASE_URL}/api/members", headers=h(tok_a))
        assert r.status_code == 200
        ids = {m["user_id"] for m in r.json()["members"]}
        assert uid_a not in ids, "self should be excluded"
        # No admin role in members list
        for m in r.json()["members"]:
            assert m["role"] != "admin"
            assert "allow_messages" in m
        # Bella should be visible
        assert uid_b in ids

    def test_members_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/members").status_code == 401


# --- Direct messages ---
class TestDMs:
    def test_send_and_thread(self, user_a_token, user_b_token):
        tok_a, uid_a = user_a_token
        tok_b, uid_b = user_b_token
        text = f"TEST_ hi bella {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/messages", headers=h(tok_a),
                          json={"recipient_id": uid_b, "text": text})
        assert r.status_code == 200, r.text
        m = r.json()["message"]
        assert m["text"] == text
        assert m["sender_id"] == uid_a and m["recipient_id"] == uid_b

        # Bella's conversations should show unread
        r2 = requests.get(f"{BASE_URL}/api/conversations", headers=h(tok_b))
        assert r2.status_code == 200
        convs = r2.json()["conversations"]
        target = next((c for c in convs if c["other_id"] == uid_a), None)
        assert target is not None
        assert target["unread"] >= 1
        assert target["last_text"] == text

        # Bella opens the thread -> messages returned, marked read
        r3 = requests.get(f"{BASE_URL}/api/messages/{uid_a}", headers=h(tok_b))
        assert r3.status_code == 200
        msgs = r3.json()["messages"]
        assert any(mm["text"] == text for mm in msgs)
        assert r3.json()["other"]["user_id"] == uid_a

        # After reading, conversations unread should be 0
        r4 = requests.get(f"{BASE_URL}/api/conversations", headers=h(tok_b))
        target2 = next((c for c in r4.json()["conversations"] if c["other_id"] == uid_a), None)
        assert target2["unread"] == 0

    def test_send_respects_optout(self, user_a_token, user_b_token):
        tok_a, _ = user_a_token
        tok_b, uid_b = user_b_token
        # Bella turns off messages
        r = requests.put(f"{BASE_URL}/api/auth/profile", headers=h(tok_b),
                         json={"allow_messages": False})
        assert r.status_code == 200
        assert r.json()["user"]["allow_messages"] is False
        # A tries to send -> 403
        r2 = requests.post(f"{BASE_URL}/api/messages", headers=h(tok_a),
                           json={"recipient_id": uid_b, "text": "should fail"})
        assert r2.status_code == 403
        # Re-enable for later tests
        r3 = requests.put(f"{BASE_URL}/api/auth/profile", headers=h(tok_b),
                          json={"allow_messages": True})
        assert r3.status_code == 200

    def test_empty_text(self, user_a_token, user_b_token):
        tok_a, _ = user_a_token
        _, uid_b = user_b_token
        r = requests.post(f"{BASE_URL}/api/messages", headers=h(tok_a),
                          json={"recipient_id": uid_b, "text": "   "})
        assert r.status_code == 400

    def test_unknown_recipient(self, user_a_token):
        tok_a, _ = user_a_token
        r = requests.post(f"{BASE_URL}/api/messages", headers=h(tok_a),
                          json={"recipient_id": "user_nonexistent", "text": "hi"})
        assert r.status_code == 404


# --- Rooms ---
class TestRooms:
    def test_rooms_list(self, user_a_token):
        tok, _ = user_a_token
        r = requests.get(f"{BASE_URL}/api/rooms", headers=h(tok))
        assert r.status_code == 200
        rooms = r.json()["rooms"]
        keys = {rm["key"] for rm in rooms}
        assert keys == {"general", "design", "plants", "help"}
        for rm in rooms:
            assert "message_count" in rm

    def test_post_and_list_room_messages(self, user_a_token):
        tok, uid = user_a_token
        text = f"TEST_ room msg {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/rooms/general/messages", headers=h(tok),
                          json={"text": text})
        assert r.status_code == 200, r.text
        assert r.json()["message"]["sender_id"] == uid
        r2 = requests.get(f"{BASE_URL}/api/rooms/general/messages", headers=h(tok))
        assert r2.status_code == 200
        assert any(m["text"] == text for m in r2.json()["messages"])

    def test_invalid_room(self, user_a_token):
        tok, _ = user_a_token
        assert requests.get(f"{BASE_URL}/api/rooms/nope/messages", headers=h(tok)).status_code == 404
        assert requests.post(f"{BASE_URL}/api/rooms/nope/messages", headers=h(tok),
                             json={"text": "x"}).status_code == 404


# --- Admin ---
class TestAdmin:
    def test_overview_requires_admin(self, user_a_token):
        tok, _ = user_a_token
        assert requests.get(f"{BASE_URL}/api/admin/overview", headers=h(tok)).status_code == 403

    def test_overview_ok(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/overview", headers=h(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "visitors" in body and "active_users" in body and "totals" in body
        assert "users" in body["totals"]

    def test_projects_owner_and_count(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/projects", headers=h(admin_token))
        assert r.status_code == 200
        projs = r.json()["projects"]
        assert isinstance(projs, list)
        for p in projs[:5]:
            assert "owner_name" in p and "owner_email" in p and "design_count" in p

    def test_admin_projects_forbidden_for_customer(self, user_a_token):
        tok, _ = user_a_token
        assert requests.get(f"{BASE_URL}/api/admin/projects", headers=h(tok)).status_code == 403

    def test_polls_and_activate(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/polls", headers=h(admin_token))
        assert r.status_code == 200
        polls = r.json()["polls"]
        assert len(polls) == 4
        active = [p for p in polls if p.get("active")]
        assert len(active) == 1
        # Pick a non-active poll and activate
        target = next(p for p in polls if not p.get("active"))
        r2 = requests.post(f"{BASE_URL}/api/admin/polls/{target['id']}/activate",
                           headers=h(admin_token))
        assert r2.status_code == 200
        assert r2.json()["poll"]["active"] is True
        # verify only one active
        r3 = requests.get(f"{BASE_URL}/api/admin/polls", headers=h(admin_token))
        actives = [p for p in r3.json()["polls"] if p.get("active")]
        assert len(actives) == 1 and actives[0]["id"] == target["id"]
        # verify /api/polls/active reflects new
        r4 = requests.get(f"{BASE_URL}/api/polls/active")
        assert r4.json()["poll"]["id"] == target["id"]

    def test_activate_forbidden_for_customer(self, user_a_token, admin_token):
        tok, _ = user_a_token
        polls = requests.get(f"{BASE_URL}/api/admin/polls", headers=h(admin_token)).json()["polls"]
        pid = polls[0]["id"]
        r = requests.post(f"{BASE_URL}/api/admin/polls/{pid}/activate", headers=h(tok))
        assert r.status_code == 403
