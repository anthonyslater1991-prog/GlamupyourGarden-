"""V4 backend tests: contractor coverage, /map/contractors reachable,
/alerts/nearby, admin report actions (warn/suspend/clear) & suspend blocks login."""
import os
import uuid
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
                 json={"postcode": "M1 1AE", "phone": "07000000000"},
                 headers=_h(tok), timeout=15)
    return {"token": tok, "user_id": data["user"]["user_id"],
            "email": "garden_test@example.com"}


@pytest.fixture(scope="module")
def admin():
    data = _login_or_register("admin@glamgarden.app", "GlamAdmin2026!")
    return {"token": data["session_token"], "user_id": data["user"]["user_id"]}


# ---------- Contractor coverage ----------
class TestContractorCoverage:
    def test_get_contractors_have_coverage_and_reachable(self, test_user):
        r = requests.get(f"{API}/map/contractors", headers=_h(test_user["token"]), timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        cons = data["contractors"]
        assert len(cons) >= 4
        for c in cons:
            assert "coverage_miles" in c
            assert isinstance(c["coverage_miles"], int)
            assert "reachable" in c
        # Manchester contractor (nearest, ~0.7km) should be reachable
        nearest = cons[0]
        assert nearest["reachable"] is True
        assert nearest["distance_km"] is not None
        assert nearest["distance_km"] <= nearest["coverage_miles"] * 1.60934

    def test_admin_can_set_coverage(self, admin, test_user):
        # Pick first contractor
        r = requests.get(f"{API}/map/contractors", headers=_h(test_user["token"]), timeout=30)
        contractor_id = r.json()["contractors"][0]["id"]

        # set to 45
        r = requests.put(f"{API}/contractors/{contractor_id}/coverage",
                         json={"miles": 45}, headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200, r.text

        # verify via /map/contractors
        r = requests.get(f"{API}/map/contractors", headers=_h(test_user["token"]), timeout=30)
        matched = next(c for c in r.json()["contractors"] if c["id"] == contractor_id)
        assert matched["coverage_miles"] == 45

    def test_customer_cannot_set_coverage(self, test_user):
        r = requests.get(f"{API}/map/contractors", headers=_h(test_user["token"]), timeout=30)
        contractor_id = r.json()["contractors"][0]["id"]
        r = requests.put(f"{API}/contractors/{contractor_id}/coverage",
                         json={"miles": 99}, headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 403


# ---------- Nearby alerts ----------
class TestNearbyAlerts:
    def test_returns_high_rated_reachable(self, test_user):
        r = requests.get(f"{API}/alerts/nearby", headers=_h(test_user["token"]), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        alerts = data["alerts"]
        # All returned must be rating >= 4.7 and reachable
        for a in alerts:
            assert a["rating"] >= 4.7
            assert a["distance_km"] <= a["coverage_miles"] * 1.60934
        # For M1 1AE we expect at least Blossom & Bee (Manchester ~0.7km)
        names = [a["name"] for a in alerts]
        assert any("Blossom" in n for n in names) or len(alerts) >= 1


# ---------- Admin report actions ----------
class TestReportActions:
    def test_admin_only_403_for_customer(self, test_user):
        r = requests.post(f"{API}/admin/reports/nonexistent/action",
                          json={"action": "warn"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 403

    def test_warn_marks_report_resolved_and_user_warned(self, test_user, admin):
        # register a throwaway target
        target_email = f"TEST_v4_warn_{uuid.uuid4().hex[:6]}@example.com"
        reg = _login_or_register(target_email, "secret123", name="TEST Warn Target")
        target_id = reg["user"]["user_id"]

        # test_user reports target
        r = requests.post(f"{API}/report",
                          json={"reported_id": target_id, "reason": "spam",
                                "context": f"TEST_ v4 warn {uuid.uuid4().hex[:6]}"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200

        # find the report id
        r = requests.get(f"{API}/admin/reports", headers=_h(admin["token"]), timeout=15)
        reports = r.json()["reports"]
        matched = next(rp for rp in reports if rp.get("reported_id") == target_id and rp.get("status") != "resolved")
        report_id = matched["id"]

        # warn
        r = requests.post(f"{API}/admin/reports/{report_id}/action",
                          json={"action": "warn"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200, r.text

        # verify report resolved
        r = requests.get(f"{API}/admin/reports", headers=_h(admin["token"]), timeout=15)
        reports = r.json()["reports"]
        this = next(rp for rp in reports if rp["id"] == report_id)
        assert this["status"] == "resolved"

        # target can still log in (warned only)
        r = requests.post(f"{API}/auth/login",
                          json={"email": target_email, "password": "secret123"}, timeout=15)
        assert r.status_code == 200

    def test_suspend_blocks_login_and_clear_restores(self, test_user, admin):
        target_email = f"TEST_v4_susp_{uuid.uuid4().hex[:6]}@example.com"
        reg = _login_or_register(target_email, "secret123", name="TEST Suspend Target")
        target_id = reg["user"]["user_id"]

        # baseline login works
        r = requests.post(f"{API}/auth/login",
                          json={"email": target_email, "password": "secret123"}, timeout=15)
        assert r.status_code == 200

        # report
        r = requests.post(f"{API}/report",
                          json={"reported_id": target_id, "reason": "spam",
                                "context": f"TEST_ v4 suspend {uuid.uuid4().hex[:6]}"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200

        r = requests.get(f"{API}/admin/reports", headers=_h(admin["token"]), timeout=15)
        matched = next(rp for rp in r.json()["reports"]
                       if rp.get("reported_id") == target_id and rp.get("status") != "resolved")
        report_id = matched["id"]

        # suspend
        r = requests.post(f"{API}/admin/reports/{report_id}/action",
                          json={"action": "suspend"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200

        # target cannot login now -> 403 suspended
        r = requests.post(f"{API}/auth/login",
                          json={"email": target_email, "password": "secret123"}, timeout=15)
        assert r.status_code == 403
        assert "suspend" in r.text.lower()

        # need another report to clear (or POST clear on same report; endpoint says report_id + action; clear resets user)
        # Reuse the same resolved report? The endpoint reads reported_id from report doc; even resolved should still work
        r = requests.post(f"{API}/admin/reports/{report_id}/action",
                          json={"action": "clear"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200

        # target can now login again
        r = requests.post(f"{API}/auth/login",
                          json={"email": target_email, "password": "secret123"}, timeout=15)
        assert r.status_code == 200, f"Clear should restore login: {r.status_code} {r.text}"

    def test_invalid_action_400(self, admin, test_user):
        # need a valid report id, else endpoint returns 404 first
        target_email = f"TEST_v4_inv_{uuid.uuid4().hex[:6]}@example.com"
        reg = _login_or_register(target_email, "secret123", name="TEST Inv")
        requests.post(f"{API}/report",
                      json={"reported_id": reg["user"]["user_id"], "reason": "spam",
                            "context": f"TEST_ v4 inv {uuid.uuid4().hex[:6]}"},
                      headers=_h(test_user["token"]), timeout=15)
        r = requests.get(f"{API}/admin/reports", headers=_h(admin["token"]), timeout=15)
        rp = next(x for x in r.json()["reports"]
                  if x.get("reported_id") == reg["user"]["user_id"] and x.get("status") != "resolved")
        r = requests.post(f"{API}/admin/reports/{rp['id']}/action",
                          json={"action": "explode"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 400
        # nonexistent report id -> 404
        r = requests.post(f"{API}/admin/reports/nonexistent/action",
                          json={"action": "warn"},
                          headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 404


# ---------- Regressions ----------
class TestRegressions:
    def test_report_still_works(self, test_user, admin):
        r = requests.post(f"{API}/report",
                          json={"reported_id": admin["user_id"], "reason": "other",
                                "context": "TEST_ v4 reg"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200

    def test_unread_endpoint(self, test_user):
        r = requests.get(f"{API}/unread", headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
        assert "count" in r.json()

    def test_polls_list(self, admin):
        r = requests.get(f"{API}/admin/polls", headers=_h(admin["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json()["polls"], list)

    def test_dm_photo_still_works(self, test_user):
        # need a recipient - use bella
        b = _login_or_register("bella@example.com", "secret123", name="Bella")
        bid = b["user"]["user_id"]
        r = requests.post(f"{API}/messages",
                          json={"recipient_id": bid, "text": "",
                                "image_path": "glam-up-your-garden/v4.jpg"},
                          headers=_h(test_user["token"]), timeout=15)
        assert r.status_code == 200
