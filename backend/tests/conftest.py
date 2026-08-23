import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://outdoor-uplift.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def test_user_token(api_client):
    """Login the seeded test user; register if missing."""
    email = "garden_test@example.com"
    password = "secret123"
    r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 401:
        r = api_client.post(f"{BASE_URL}/api/auth/register", json={
            "name": "Garden Test", "email": email, "password": password
        })
    assert r.status_code == 200, f"login/register failed: {r.status_code} {r.text}"
    data = r.json()
    assert "session_token" in data
    return data["session_token"]


@pytest.fixture(scope="session")
def auth_headers(test_user_token):
    return {"Authorization": f"Bearer {test_user_token}"}
