"""V6 backend tests: Price History (latest + retailer), Best Value Badge (>=3 prices),
Reuse My Style (PUT /api/auth/style persists on user & public_user), Wishlist From Bot
(POST /api/assistant/products returns JSON array). Plus regression on POST /api/redesign
and product-prices add/get."""
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


def _login_or_register(email, password, name="Tester", **extra):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 401:
        body = {"name": name, "email": email, "password": password, **extra}
        r = requests.post(f"{API}/auth/register", json=body, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d["session_token"], "user": d["user"]}


# ------- shared session fixtures -------
@pytest.fixture(scope="module")
def user_a():
    return _login_or_register("garden_test@example.com", "secret123", name="Garden Test")


@pytest.fixture(scope="module")
def user_b():
    return _login_or_register("bella@example.com", "secret123", name="Bella")


@pytest.fixture(scope="module")
def user_c():
    return _login_or_register("cara@example.com", "secret123", name="Cara")


# --------------------------- Price History ---------------------------
class TestPriceHistory:
    # Uses a fresh product name per test session so it starts empty
    prod = f"TEST_v6_history_{uuid.uuid4().hex[:6]}"

    def test_add_first_price_returns_latest_with_retailer(self, user_a):
        r = requests.post(f"{API}/product-prices",
                          json={"name": self.prod, "price": "45", "retailer": "B&Q",
                                "url": "https://www.diy.com/x"},
                          headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == self.prod
        assert data["count"] == 1
        assert data["avg"] == 45.0
        assert data["avg_display"] in ("£45", "£45.00")
        # latest must contain the just-added record with retailer
        assert isinstance(data["latest"], list) and len(data["latest"]) == 1
        latest0 = data["latest"][0]
        assert latest0["retailer"] == "B&Q"
        assert latest0["display"].startswith("£45")
        assert latest0["user_name"]  # must include user name
        # No best_value yet (count < 3)
        assert data["best_value"] is None

    def test_add_second_price_returns_two_latest(self, user_b):
        r = requests.post(f"{API}/product-prices",
                          json={"name": self.prod, "price": "40.50", "retailer": "Homebase"},
                          headers=_h(user_b["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] == 2
        assert data["best_value"] is None  # still under 3
        assert len(data["latest"]) == 2
        # sorted by created_at desc - most recent first
        assert data["latest"][0]["retailer"] == "Homebase"
        assert data["latest"][1]["retailer"] == "B&Q"

    def test_third_price_triggers_best_value_and_returns_cheapest(self, user_c):
        r = requests.post(f"{API}/product-prices",
                          json={"name": self.prod, "price": "39.99", "retailer": "Wickes"},
                          headers=_h(user_c["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] == 3
        # cheapest is Wickes £39.99
        assert data["best_value"] is not None
        assert data["best_value"]["retailer"] == "Wickes"
        assert data["best_value"]["display"] == "£39.99"
        # latest has all 3, most recent first
        assert len(data["latest"]) == 3
        assert data["latest"][0]["retailer"] == "Wickes"

    def test_get_prices_returns_summary_with_latest_and_best_value(self, user_a):
        r = requests.get(f"{API}/product-prices",
                         params={"name": self.prod},
                         headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] == 3
        assert data["best_value"]["retailer"] == "Wickes"
        assert data["best_value"]["display"] == "£39.99"
        # Retailers present on each latest entry
        retailers = sorted([p["retailer"] for p in data["latest"]])
        assert retailers == ["B&Q", "Homebase", "Wickes"]

    def test_invalid_price_returns_400(self, user_a):
        r = requests.post(f"{API}/product-prices",
                          json={"name": "TEST_v6_invalid", "price": "not a price"},
                          headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 400, r.text

    def test_prices_require_auth(self):
        r = requests.get(f"{API}/product-prices", params={"name": self.prod}, timeout=15)
        assert r.status_code == 401


# --------------------------- Reuse My Style ---------------------------
class TestReuseMyStyle:
    def test_put_style_persists_and_returns_in_public_user(self, user_a):
        style_payload = {
            "style": "modern-tranquil",
            "gardenType": "small urban patio",
            "mood": "calm",
            "colourScheme": "greens and cream",
            "ornaments": ["Solar lanterns", "Wooden pergola"],
        }
        r = requests.put(f"{API}/auth/style",
                         json={"data": style_payload},
                         headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        pub = r.json()["user"]
        assert pub["saved_style"] == style_payload

        # Verify persistence via /auth/me
        r2 = requests.get(f"{API}/auth/me", headers=_h(user_a["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        me = r2.json()["user"]
        assert me["saved_style"] == style_payload

    def test_style_can_be_overwritten(self, user_a):
        new_style = {"style": "cottage-bloom", "gardenType": "large lawn"}
        r = requests.put(f"{API}/auth/style",
                         json={"data": new_style},
                         headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["saved_style"] == new_style

    def test_style_requires_auth(self):
        r = requests.put(f"{API}/auth/style", json={"data": {"x": 1}}, timeout=15)
        assert r.status_code == 401


# --------------------------- Wishlist From Bot ---------------------------
class TestAssistantProducts:
    def test_returns_list_of_product_strings(self, user_a):
        r = requests.post(f"{API}/assistant/products",
                          json={"prompt": "cosy modern patio with lots of green plants"},
                          headers=_h(user_a["token"]), timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "products" in data
        products = data["products"]
        assert isinstance(products, list)
        assert 1 <= len(products) <= 6
        # every entry is a non-empty string
        for p in products:
            assert isinstance(p, str) and p.strip()

    def test_empty_prompt_still_returns_products(self, user_a):
        r = requests.post(f"{API}/assistant/products",
                          json={},
                          headers=_h(user_a["token"]), timeout=60)
        assert r.status_code == 200, r.text
        products = r.json()["products"]
        assert isinstance(products, list) and len(products) >= 1

    def test_requires_auth(self):
        r = requests.post(f"{API}/assistant/products", json={"prompt": "x"}, timeout=15)
        assert r.status_code == 401


# --------------------------- Redesign regression ---------------------------
class TestRedesignRegression:
    def test_redesign_still_works_with_wishlist_bq_first(self, user_a):
        # Reuse an existing project with an uploaded photo, else skip.
        r = requests.get(f"{API}/projects", headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 200
        projects = r.json()["projects"]
        target = next((p for p in projects if p.get("original_path")), None)
        if not target:
            pytest.skip("No project with uploaded photo available for regression.")

        payload = {
            "changes": ["Add a seating area"],
            "style": "modern-tranquil",
            "garden_type": "small urban patio",
            "mood": "calm",
            "colour_scheme": "greens and cream",
            "ornaments": ["Solar lanterns"],
            "must_haves": "Space for two chairs",
            "wishlist": ["TEST_v6 Ego mower", "TEST_v6 Weber BBQ"],
            "notes": "TEST_ v6 regression",
        }
        r = requests.post(f"{API}/projects/{target['id']}/redesign",
                          json=payload, headers=_h(user_a["token"]), timeout=180)
        if r.status_code == 502:
            pytest.skip("AI image gen 502; retry manually.")
        assert r.status_code == 200, r.text
        design = r.json()["design"]
        hotspots = design["hotspots"]
        assert len(hotspots) >= 2
        assert hotspots[0]["name"] == "TEST_v6 Ego mower"
        assert hotspots[0]["retailer"] == "B&Q"
        assert "diy.com" in hotspots[0]["url"]
        assert hotspots[1]["name"] == "TEST_v6 Weber BBQ"
        assert hotspots[1]["retailer"] == "B&Q"
