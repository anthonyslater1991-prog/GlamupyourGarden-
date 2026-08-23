from fastapi import FastAPI, APIRouter, UploadFile, File, Header, HTTPException, Depends, Query
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import base64
import logging
import uuid
import random
import io
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import httpx
import requests
from pydantic import BaseModel, Field, EmailStr

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("glam")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
# A REAL Stripe test secret (sk_test_.../rk_test_...) enables Stripe Connect payouts.
# The built-in proxy key (sk_test_emergent) only supports Checkout, not Connect.
STRIPE_CONNECT_SECRET_KEY = os.environ.get("STRIPE_CONNECT_SECRET_KEY", "")


def _real_stripe() -> bool:
    k = STRIPE_CONNECT_SECRET_KEY
    return k.startswith("sk_") or k.startswith("rk_")


if _real_stripe():
    import stripe as _stripe_sdk
    _stripe_sdk.api_key = STRIPE_CONNECT_SECRET_KEY
IMAGE_MODEL = "gemini-3.1-flash-image-preview"
TEXT_MODEL = "gpt-5.4-mini"

# ---------------------------------------------------------------------------
# Object storage
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "glam-up-your-garden"
_storage_key = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------------------
# App / router
# ---------------------------------------------------------------------------
app = FastAPI()
api_router = APIRouter(prefix="/api")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str = "customer"
    phone: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class SessionInput(BaseModel):
    session_id: str


class ProfileUpdate(BaseModel):
    bio: Optional[str] = None
    allow_messages: Optional[bool] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None


class ProjectCreate(BaseModel):
    title: str
    original_path: Optional[str] = None


class RedesignInput(BaseModel):
    changes: List[str] = []
    style: Optional[str] = None
    notes: Optional[str] = None
    garden_type: Optional[str] = None
    mood: Optional[str] = None
    colour_scheme: Optional[str] = None
    ornaments: List[str] = []
    must_haves: Optional[str] = None
    wishlist: List[str] = []


class WallPostCreate(BaseModel):
    caption: str
    image_path: Optional[str] = None


class ReviewCreate(BaseModel):
    rating: int
    text: str
    image_paths: List[str] = []
    contract_id: Optional[str] = None


class VoteInput(BaseModel):
    option_index: int


class ChatInput(BaseModel):
    session_id: str
    message: str


class CoverageInput(BaseModel):
    miles: int


class ReportActionInput(BaseModel):
    action: str  # warn | suspend | clear


class ContractCreate(BaseModel):
    contractor_id: str
    project_id: Optional[str] = None
    scope: Optional[str] = None
    price: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    deposit_percent: Optional[int] = None
    payment_terms: Optional[str] = None
    materials: Optional[str] = None
    warranty: Optional[str] = None
    site_address: Optional[str] = None
    notes: Optional[str] = None


class ContractUpdate(BaseModel):
    scope: Optional[str] = None
    price: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    deposit_percent: Optional[int] = None
    payment_terms: Optional[str] = None
    materials: Optional[str] = None
    warranty: Optional[str] = None
    site_address: Optional[str] = None
    notes: Optional[str] = None


class ContractMessage(BaseModel):
    text: str


class ContractSign(BaseModel):
    full_name: str
    agree: bool = True


class StageUpdate(BaseModel):
    stage_index: int
    note: Optional[str] = None


class ClaimAction(BaseModel):
    action: str  # approve | reject


class ContractorProfileUpdate(BaseModel):
    tagline: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    postcode: Optional[str] = None
    services: Optional[List[str]] = None
    coverage_miles: Optional[int] = None


class ReviewReply(BaseModel):
    text: str


class DepositRequest(BaseModel):
    origin: str


class QuoteItem(BaseModel):
    label: str
    amount: float


class QuoteSubmit(BaseModel):
    amount: Optional[float] = None
    items: List[QuoteItem] = []
    note: Optional[str] = None


class QuoteRespond(BaseModel):
    accept: bool


class ConnectOnboard(BaseModel):
    origin: str


class ReleaseInput(BaseModel):
    fee_percent: Optional[float] = None


class SettingsInput(BaseModel):
    platform_fee_percent: float


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
async def create_session(user_id: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    })
    return token


def public_user(u: dict) -> dict:
    return {
        "user_id": u["user_id"],
        "name": u.get("name"),
        "email": u.get("email"),
        "role": u.get("role", "customer"),
        "picture": u.get("picture"),
        "bio": u.get("bio", ""),
        "allow_messages": u.get("allow_messages", True),
        "phone": u.get("phone", ""),
        "address": u.get("address", ""),
        "postcode": u.get("postcode", ""),
        "saved_style": u.get("saved_style"),
    }


async def resolve_user(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        return None
    exp = sess.get("expires_at")
    if exp:
        try:
            exp_dt = datetime.fromisoformat(exp)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt < datetime.now(timezone.utc):
                return None
        except Exception:
            pass
    return await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    user = await resolve_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(body: RegisterInput):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = {
        "user_id": new_id("user"),
        "name": body.name,
        "email": body.email.lower(),
        "password_hash": pw_hash,
        "role": body.role if body.role in ("customer", "contractor") else "customer",
        "picture": None,
        "bio": "",
        "allow_messages": True,
        "phone": body.phone or "",
        "address": body.address or "",
        "postcode": (body.postcode or "").upper().strip(),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    token = await create_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api_router.post("/auth/login")
async def login(body: LoginInput):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="Your account has been suspended. Contact support.")
    token = await create_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api_router.post("/auth/session")
async def google_session(body: SessionInput):
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = r.json()
    email = (data.get("email") or "").lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        user = existing
    else:
        user = {
            "user_id": new_id("user"),
            "name": data.get("name"),
            "email": email,
            "password_hash": None,
            "role": "customer",
            "picture": data.get("picture"),
            "bio": "",
            "allow_messages": True,
            "created_at": now_iso(),
        }
        await db.users.insert_one(user)
    token = await create_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": public_user(user)}


@api_router.put("/auth/profile")
async def update_profile(body: ProfileUpdate, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if "postcode" in updates:
        updates["postcode"] = updates["postcode"].upper().strip()
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(fresh)}


# ---------------------------------------------------------------------------
# File upload / download
# ---------------------------------------------------------------------------
@api_router.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    data = await file.read()
    ext = (file.filename or "img.jpg").split(".")[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    ct = file.content_type or "image/jpeg"
    result = await run_in_threadpool(put_object, path, data, ct)
    await db.uploads.insert_one({
        "path": result["path"], "owner_id": user["user_id"], "content_type": ct, "created_at": now_iso(),
    })
    return {"path": result["path"]}


@api_router.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    bearer = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
    user = await resolve_user(token or bearer)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    rec = await db.uploads.find_one({"path": path}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    content, ct = await run_in_threadpool(get_object, path)
    return Response(content=content, media_type=ct)


# ---------------------------------------------------------------------------
# AI garden redesign
# ---------------------------------------------------------------------------
RETAILERS = [
    ("Amazon", "https://www.amazon.co.uk/s?k="),
    ("B&Q", "https://www.diy.com/search?term="),
    ("Wayfair", "https://www.wayfair.co.uk/keyword.php?keyword="),
    ("Homebase", "https://www.homebase.co.uk/search?q="),
    ("Gardening Express", "https://www.gardeningexpress.co.uk/catalogsearch/result/?q="),
]

HOTSPOT_POSITIONS = [
    {"x": 0.24, "y": 0.34}, {"x": 0.68, "y": 0.28}, {"x": 0.42, "y": 0.62},
    {"x": 0.78, "y": 0.68}, {"x": 0.16, "y": 0.72}, {"x": 0.55, "y": 0.44},
]


async def generate_hotspots(changes: List[str], style: Optional[str], colour_scheme: Optional[str] = None, wishlist: Optional[List[str]] = None) -> List[dict]:
    change_text = ", ".join(changes) if changes else "general garden improvements"
    colour_txt = f" Colour scheme: {colour_scheme}." if colour_scheme else ""
    prompt = (
        f"A homeowner redesigned their garden with these changes: {change_text}. "
        f"Style: {style or 'natural'}.{colour_txt} Suggest 4 realistic shoppable products they would buy to achieve this look. "
        "Return ONLY a JSON array. Each item: {\"name\": short product name, \"description\": one short sentence, "
        "\"price\": realistic GBP price like \"£49\", \"search_query\": simple search keywords}. No markdown."
    )
    products = []
    try:
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=new_id("hs"),
                       system_message="You are a garden product expert. Reply with strict JSON only.")
        chat.with_model("openai", TEXT_MODEL)
        text = await chat.send_message(UserMessage(text=prompt))
        cleaned = re.sub(r"```(json)?", "", text).strip()
        match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if match:
            products = json.loads(match.group(0))
    except Exception as e:
        logger.warning(f"hotspot gen failed: {e}")

    if not products:
        products = [
            {"name": "Outdoor Patio Set", "description": "Weather-resistant seating for your new space.", "price": "£249", "search_query": "garden patio furniture set"},
            {"name": "LED Garden Lights", "description": "Warm solar path lighting.", "price": "£29", "search_query": "solar garden lights outdoor"},
            {"name": "Potted Plants Bundle", "description": "Lush greenery to add colour.", "price": "£39", "search_query": "outdoor potted plants bundle"},
            {"name": "Decorative Planter", "description": "Stylish planter as a focal point.", "price": "£45", "search_query": "large outdoor planter"},
        ]

    hotspots = []
    # The customer's own specified items/brands become dedicated shoppable pins.
    # For now these link to a default supplier (B&Q); later these become affiliate links.
    for item in (wishlist or []):
        if len(hotspots) >= len(HOTSPOT_POSITIONS):
            break
        q = f"{item}".replace(" ", "+")
        pos = HOTSPOT_POSITIONS[len(hotspots)]
        hotspots.append({
            "id": new_id("hot"),
            "name": item,
            "description": "Your requested item — tap to shop at the supplier.",
            "price": "",
            "retailer": "B&Q",
            "url": f"https://www.diy.com/search?term={q}",
            "x": pos["x"],
            "y": pos["y"],
        })

    start = len(hotspots)
    for i, p in enumerate(products[: len(HOTSPOT_POSITIONS) - start]):
        retailer, base_url = random.choice(RETAILERS)
        query = (p.get("search_query") or p.get("name") or "garden").replace(" ", "+")
        pos = HOTSPOT_POSITIONS[start + i]
        hotspots.append({
            "id": new_id("hot"),
            "name": p.get("name", "Product"),
            "description": p.get("description", ""),
            "price": p.get("price", ""),
            "retailer": retailer,
            "url": base_url + query,
            "x": pos["x"],
            "y": pos["y"],
        })
    return hotspots


@api_router.post("/projects/{project_id}/redesign")
async def redesign(project_id: str, body: RedesignInput, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "owner_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.get("original_path"):
        raise HTTPException(status_code=400, detail="Project has no garden photo")

    original_bytes, _ = await run_in_threadpool(get_object, project["original_path"])
    image_b64 = base64.b64encode(original_bytes).decode("utf-8")

    change_text = ", ".join(body.changes) if body.changes else "make it more beautiful and tidy"
    style = body.style or "lush and tranquil"
    details = []
    if body.garden_type:
        details.append(f"Garden type: {body.garden_type}")
    if body.mood:
        details.append(f"Mood/feel: {body.mood}")
    if body.colour_scheme:
        details.append(f"Colour scheme: {body.colour_scheme}")
    if body.ornaments:
        details.append(f"Include these features/ornaments: {', '.join(body.ornaments)}")
    if body.wishlist:
        details.append(f"The customer specifically wants these exact items/brands: {', '.join(body.wishlist)}")
    if body.must_haves:
        details.append(f"Must include: {body.must_haves}")
    if body.notes:
        details.append(f"Extra notes: {body.notes}")
    detail_text = (" " + ". ".join(details) + ".") if details else ""
    prompt = (
        f"Redesign and beautify this real garden photo. Keep the same camera angle, perspective and overall layout, "
        f"but transform it into a stunning, professionally landscaped {style} garden. Apply these improvements: {change_text}.{detail_text} "
        "Make it photorealistic with natural lighting, realistic colours, healthy plants, and clean finishes. "
        "The result should look like a real 'after' photo of a garden makeover."
    )

    try:
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=new_id("img"),
                       system_message="You are an expert garden landscape photo editor.")
        chat.with_model("gemini", IMAGE_MODEL).with_params(modalities=["image", "text"])
        msg = UserMessage(text=prompt, file_contents=[ImageContent(image_b64)])
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.error(f"redesign gen failed: {e}")
        raise HTTPException(status_code=502, detail="AI redesign failed. Please try again.")

    if not images:
        raise HTTPException(status_code=502, detail="No image was generated. Please try again.")

    img = images[0]
    out_bytes = base64.b64decode(img["data"])
    out_path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.png"
    await run_in_threadpool(put_object, out_path, out_bytes, "image/png")
    await db.uploads.insert_one({"path": out_path, "owner_id": user["user_id"], "content_type": "image/png", "created_at": now_iso()})

    hotspots = await generate_hotspots(body.changes + body.ornaments, body.style, body.colour_scheme, body.wishlist)

    design = {
        "id": new_id("design"),
        "image_path": out_path,
        "changes": body.changes,
        "style": body.style,
        "garden_type": body.garden_type,
        "mood": body.mood,
        "colour_scheme": body.colour_scheme,
        "ornaments": body.ornaments,
        "wishlist": body.wishlist,
        "hotspots": hotspots,
        "saved": False,
        "created_at": now_iso(),
    }
    await db.projects.update_one({"id": project_id}, {"$push": {"designs": design}, "$set": {"updated_at": now_iso()}})
    return {"design": design}


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
@api_router.post("/projects")
async def create_project(body: ProjectCreate, user: dict = Depends(get_current_user)):
    project = {
        "id": new_id("proj"),
        "owner_id": user["user_id"],
        "title": body.title,
        "original_path": body.original_path,
        "designs": [],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.projects.insert_one(project)
    project.pop("_id", None)
    return {"project": project}


@api_router.get("/projects")
async def list_projects(user: dict = Depends(get_current_user)):
    docs = await db.projects.find({"owner_id": user["user_id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return {"projects": docs}


@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"id": project_id, "owner_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return {"project": doc}


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    await db.projects.delete_one({"id": project_id, "owner_id": user["user_id"]})
    return {"ok": True}


@api_router.post("/projects/{project_id}/designs/{design_id}/save")
async def save_design(project_id: str, design_id: str, user: dict = Depends(get_current_user)):
    await db.projects.update_one(
        {"id": project_id, "owner_id": user["user_id"], "designs.id": design_id},
        {"$set": {"designs.$.saved": True}},
    )
    return {"ok": True}


class GalleryAdd(BaseModel):
    image_path: str
    note: Optional[str] = None


@api_router.post("/projects/{project_id}/gallery")
async def add_to_gallery(project_id: str, body: GalleryAdd, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "owner_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    item = {"id": new_id("gal"), "image_path": body.image_path, "note": body.note or "", "created_at": now_iso()}
    await db.projects.update_one({"id": project_id}, {"$push": {"gallery": item}, "$set": {"updated_at": now_iso()}})
    return {"item": item}


class PriceInput(BaseModel):
    name: str
    price: str
    retailer: Optional[str] = None
    url: Optional[str] = None


def _name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (name or "").lower()).strip()


def _parse_amount(price: str):
    m = re.search(r"[\d]+(?:\.[\d]{1,2})?", (price or "").replace(",", ""))
    return float(m.group(0)) if m else None


@api_router.post("/product-prices")
async def add_price(body: PriceInput, user: dict = Depends(get_current_user)):
    amount = _parse_amount(body.price)
    if amount is None:
        raise HTTPException(status_code=400, detail="Enter a valid price")
    entry = {
        "id": new_id("price"),
        "name": body.name.strip(),
        "name_key": _name_key(body.name),
        "amount": amount,
        "display": f"£{amount:.2f}".rstrip("0").rstrip(".") if amount == int(amount) else f"£{amount:.2f}",
        "retailer": body.retailer or "",
        "url": body.url or "",
        "user_id": user["user_id"],
        "user_name": user.get("name") or "A gardener",
        "created_at": now_iso(),
    }
    await db.product_prices.insert_one(entry)
    return await _price_summary(body.name)


async def _price_summary(name: str):
    key = _name_key(name)
    docs = await db.product_prices.find({"name_key": key}, {"_id": 0}).sort("created_at", -1).to_list(200)
    amounts = [d["amount"] for d in docs if d.get("amount") is not None]
    avg = round(sum(amounts) / len(amounts), 2) if amounts else None
    best_value = None
    if len(docs) >= 3:
        best = min(docs, key=lambda d: d["amount"])
        best_value = {"display": best["display"], "retailer": best.get("retailer") or "a supplier"}
    return {
        "name": name,
        "count": len(docs),
        "avg": avg,
        "avg_display": (f"£{avg:.2f}".rstrip("0").rstrip(".") if avg is not None and avg == int(avg) else (f"£{avg:.2f}" if avg is not None else None)),
        "best_value": best_value,
        "latest": docs[:5],
    }


@api_router.get("/product-prices")
async def get_prices(name: str = Query(...), user: dict = Depends(get_current_user)):
    return await _price_summary(name)


class StyleInput(BaseModel):
    data: dict


@api_router.put("/auth/style")
async def save_style(body: StyleInput, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"saved_style": body.data}})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(fresh)}


class AssistProducts(BaseModel):
    prompt: Optional[str] = None


@api_router.post("/assistant/products")
async def assistant_products(body: AssistProducts, user: dict = Depends(get_current_user)):
    ask = body.prompt or "a beautiful low-maintenance garden"
    prompt = (
        f"A homeowner wants: {ask}. Suggest 6 specific, real, buyable garden products/items (with a brand or clear type) "
        "they could add. Return ONLY a JSON array of short product name strings, e.g. "
        "[\"Rattan corner sofa set\", \"Solar festoon lights\"]. No markdown, no extra text."
    )
    items: List[str] = []
    try:
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=new_id("ap"),
                       system_message="You are a garden product expert. Reply with strict JSON only.")
        chat.with_model("openai", TEXT_MODEL)
        text = await chat.send_message(UserMessage(text=prompt))
        cleaned = re.sub(r"```(json)?", "", text).strip()
        m = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if m:
            arr = json.loads(m.group(0))
            items = [str(x) for x in arr if isinstance(x, (str,))][:6]
    except Exception as e:
        logger.warning(f"assistant products failed: {e}")
    if not items:
        items = ["Rattan corner sofa set", "Solar festoon lights", "Large ceramic planter", "Composite decking boards", "Outdoor rug", "Fire pit bowl"]
    return {"products": items}


# ---------------------------------------------------------------------------
# Community wall
# ---------------------------------------------------------------------------
@api_router.get("/wall")
async def get_wall():
    docs = await db.wall_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"posts": docs}


@api_router.post("/wall")
async def create_wall_post(body: WallPostCreate, user: dict = Depends(get_current_user)):
    post = {
        "id": new_id("post"),
        "author_id": user["user_id"],
        "author_name": user.get("name") or "Gardener",
        "author_picture": user.get("picture"),
        "caption": body.caption,
        "image_path": body.image_path,
        "likes": 0,
        "reactions": {},
        "comments": [],
        "created_at": now_iso(),
    }
    await db.wall_posts.insert_one(post)
    post.pop("_id", None)
    return {"post": post}


@api_router.post("/wall/{post_id}/like")
async def like_post(post_id: str, user: dict = Depends(get_current_user)):
    await db.wall_posts.update_one({"id": post_id}, {"$inc": {"likes": 1}})
    doc = await db.wall_posts.find_one({"id": post_id}, {"_id": 0})
    return {"post": doc}


class ReactInput(BaseModel):
    emoji: str


class CommentInput(BaseModel):
    text: str


@api_router.post("/wall/{post_id}/react")
async def react_post(post_id: str, body: ReactInput, user: dict = Depends(get_current_user)):
    emoji = (body.emoji or "").strip()[:8]
    if not emoji:
        raise HTTPException(status_code=400, detail="No emoji")
    await db.wall_posts.update_one({"id": post_id}, {"$inc": {f"reactions.{emoji}": 1}})
    doc = await db.wall_posts.find_one({"id": post_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return {"post": doc}


@api_router.post("/wall/{post_id}/comment")
async def comment_post(post_id: str, body: CommentInput, user: dict = Depends(get_current_user)):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty comment")
    post = await db.wall_posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Not found")
    comment = {
        "id": new_id("cmt"),
        "author_id": user["user_id"],
        "author_name": user.get("name") or "Gardener",
        "author_picture": user.get("picture"),
        "text": body.text.strip(),
        "created_at": now_iso(),
    }
    await db.wall_posts.update_one({"id": post_id}, {"$push": {"comments": comment}})
    doc = await db.wall_posts.find_one({"id": post_id}, {"_id": 0})
    return {"post": doc, "comment": comment}


# ---------------------------------------------------------------------------
# Contractors
# ---------------------------------------------------------------------------
@api_router.get("/contractors")
async def list_contractors():
    docs = await db.contractors.find({}, {"_id": 0}).to_list(100)
    return {"contractors": docs}


@api_router.get("/contractors/{contractor_id}")
async def get_contractor(contractor_id: str):
    doc = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    reviews = await db.reviews.find({"contractor_id": contractor_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"contractor": doc, "reviews": reviews}


@api_router.post("/contractors/{contractor_id}/reviews")
async def add_review(contractor_id: str, body: ReviewCreate, user: dict = Depends(get_current_user)):
    contractor = await db.contractors.find_one({"id": contractor_id})
    if not contractor:
        raise HTTPException(status_code=404, detail="Not found")
    review = {
        "id": new_id("rev"),
        "contractor_id": contractor_id,
        "author_name": user.get("name") or "Customer",
        "rating": max(1, min(5, body.rating)),
        "text": body.text,
        "image_paths": (body.image_paths or [])[:6],
        "created_at": now_iso(),
    }
    await db.reviews.insert_one(review)
    reviews = await db.reviews.find({"contractor_id": contractor_id}).to_list(1000)
    avg = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
    await db.contractors.update_one({"id": contractor_id}, {"$set": {"rating": avg, "review_count": len(reviews)}})
    review.pop("_id", None)
    # If this review came from a completed-job reminder, mark that contract reviewed
    if body.contract_id:
        await db.contracts.update_one(
            {"id": body.contract_id, "customer_id": user["user_id"]},
            {"$set": {"reviewed": True}},
        )
    else:
        await db.contracts.update_many(
            {"contractor_id": contractor_id, "customer_id": user["user_id"], "status": "completed"},
            {"$set": {"reviewed": True}},
        )
    return {"review": review, "rating": avg, "review_count": len(reviews)}


@api_router.put("/contractors/{contractor_id}/coverage")
async def set_coverage(contractor_id: str, body: CoverageInput, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "contractor"):
        raise HTTPException(status_code=403, detail="Only contractors or admins can set coverage")
    miles = max(1, min(500, body.miles))
    res = await db.contractors.update_one({"id": contractor_id}, {"$set": {"coverage_miles": miles}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    return {"contractor": doc}


# ---------------------------------------------------------------------------
# Contractor accounts: claim listing (admin-approved), manage profile, reply to reviews
# ---------------------------------------------------------------------------
async def owned_contractor_ids(user: dict) -> List[str]:
    if user.get("role") != "contractor":
        return []
    docs = await db.contractors.find({"claimed_by": user["user_id"], "claim_status": "approved"}, {"id": 1, "_id": 0}).to_list(50)
    return [d["id"] for d in docs]


async def can_manage_contractor(user: dict, contractor_id: str) -> bool:
    if user.get("role") == "admin":
        return True
    c = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    return bool(c and c.get("claim_status") == "approved" and c.get("claimed_by") == user["user_id"])


@api_router.post("/contractors/{contractor_id}/claim")
async def claim_contractor(contractor_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "contractor":
        raise HTTPException(status_code=403, detail="Only contractor accounts can claim a listing")
    c = await db.contractors.find_one({"id": contractor_id})
    if not c:
        raise HTTPException(status_code=404, detail="Listing not found")
    if c.get("claim_status") == "approved":
        if c.get("claimed_by") == user["user_id"]:
            return {"ok": True, "claim_status": "approved"}
        raise HTTPException(status_code=400, detail="This listing is already claimed by another contractor")
    # only one active claim per contractor at a time
    await db.contractors.update_one({"id": contractor_id}, {"$set": {
        "claim_status": "pending",
        "claim_user_id": user["user_id"],
        "claim_user_name": user.get("name"),
        "claim_requested_at": now_iso(),
    }})
    return {"ok": True, "claim_status": "pending"}


@api_router.get("/my-contractor")
async def my_contractor(user: dict = Depends(get_current_user)):
    if user.get("role") != "contractor":
        return {"contractor": None, "pending": None}
    approved = await db.contractors.find_one({"claimed_by": user["user_id"], "claim_status": "approved"}, {"_id": 0})
    pending = await db.contractors.find_one({"claim_user_id": user["user_id"], "claim_status": "pending"}, {"_id": 0})
    return {"contractor": approved, "pending": pending}


@api_router.put("/contractors/{contractor_id}/profile")
async def update_contractor_profile(contractor_id: str, body: ContractorProfileUpdate, user: dict = Depends(get_current_user)):
    if not await can_manage_contractor(user, contractor_id):
        raise HTTPException(status_code=403, detail="You don't manage this listing")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "coverage_miles" in updates:
        updates["coverage_miles"] = max(1, min(500, int(updates["coverage_miles"])))
    if updates:
        await db.contractors.update_one({"id": contractor_id}, {"$set": updates})
    doc = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    return {"contractor": doc}


@api_router.post("/contractors/{contractor_id}/reviews/{review_id}/reply")
async def reply_to_review(contractor_id: str, review_id: str, body: ReviewReply, user: dict = Depends(get_current_user)):
    if not await can_manage_contractor(user, contractor_id):
        raise HTTPException(status_code=403, detail="You don't manage this listing")
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Reply is empty")
    res = await db.reviews.update_one(
        {"id": review_id, "contractor_id": contractor_id},
        {"$set": {"reply": body.text.strip(), "reply_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")
    review = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return {"review": review}


@api_router.get("/admin/claims")
async def list_claims(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    docs = await db.contractors.find({"claim_status": "pending"}, {"_id": 0}).to_list(100)
    return {"claims": docs}


@api_router.post("/admin/claims/{contractor_id}/action")
async def act_on_claim(contractor_id: str, body: ClaimAction, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    c = await db.contractors.find_one({"id": contractor_id})
    if not c or c.get("claim_status") != "pending":
        raise HTTPException(status_code=404, detail="No pending claim for this listing")
    if body.action == "approve":
        await db.contractors.update_one({"id": contractor_id}, {"$set": {
            "claim_status": "approved",
            "claimed_by": c.get("claim_user_id"),
            "claim_approved_at": now_iso(),
        }})
    elif body.action == "reject":
        await db.contractors.update_one({"id": contractor_id}, {"$set": {"claim_status": "unclaimed"}, "$unset": {"claim_user_id": "", "claim_user_name": ""}})
    else:
        raise HTTPException(status_code=400, detail="action must be approve or reject")
    doc = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    return {"contractor": doc}


# ---------------------------------------------------------------------------
# Contracts (auto-drafted service agreements + job tracker)
# ---------------------------------------------------------------------------
DEFAULT_STAGES = [
    "Quote agreed",
    "Deposit paid",
    "Materials ordered",
    "Work in progress",
    "Final tidy & handover",
]

# Standard protective clauses included in every agreement (fixed, plain-English)
STANDARD_CLAUSES = [
    ("Quality of work", "The contractor will carry out the work in a professional and workmanlike manner, to a reasonable standard, using materials fit for purpose."),
    ("Variations & extras", "Any change to the scope, materials or price must be agreed in writing by both parties (via the in-app discussion) before the extra work begins."),
    ("Access & site", "The customer will provide safe and reasonable access to the site during agreed working hours. The contractor will keep the site tidy and safe."),
    ("Waste & clearance", "Unless stated otherwise, the contractor will remove their own work waste and leave the garden clean on completion."),
    ("Insurance & liability", "The contractor confirms they hold appropriate public liability insurance. Each party is responsible for loss or damage caused by their own negligence."),
    ("Cancellation", "Either party may cancel with reasonable written notice. If the customer cancels after work/materials have started, they will pay for work done and materials already ordered."),
    ("Payment", "Payment is due as per the schedule below. Late balance payments may pause further work until settled."),
    ("Dispute resolution", "The parties will first try to resolve any disagreement amicably via the in-app discussion. This agreement is governed by the laws of England & Wales."),
    ("Consumer rights", "Nothing in this agreement affects the customer's statutory rights under UK consumer law."),
]


def public_contract(c: dict) -> dict:
    c = dict(c)
    c.pop("_id", None)
    return c


async def _contract_or_404(contract_id: str, user: dict) -> dict:
    c = await db.contracts.find_one({"id": contract_id})
    if not c:
        raise HTTPException(status_code=404, detail="Contract not found")
    is_customer = c.get("customer_id") == user["user_id"]
    is_admin = user.get("role") == "admin"
    is_owner_pro = user.get("role") == "contractor" and c.get("contractor_id") in await owned_contractor_ids(user)
    if not (is_customer or is_admin or is_owner_pro):
        raise HTTPException(status_code=403, detail="You cannot access this contract")
    return c


def _fully_signed(c: dict) -> bool:
    return bool(c.get("customer_signed")) and bool(c.get("contractor_signed"))


@api_router.post("/contracts")
async def create_contract(body: ContractCreate, user: dict = Depends(get_current_user)):
    contractor = await db.contractors.find_one({"id": body.contractor_id}, {"_id": 0})
    if not contractor:
        raise HTTPException(status_code=404, detail="Contractor not found")

    project = None
    if body.project_id:
        project = await db.projects.find_one({"id": body.project_id, "owner_id": user["user_id"]}, {"_id": 0})

    services = ", ".join(contractor.get("services", [])) or "garden landscaping"
    proj_title = (project or {}).get("title")
    scope = body.scope or (
        f"Garden work for '{proj_title}': {services}." if proj_title else f"Garden work: {services}."
    )
    start = body.start_date or "To be agreed"
    end = body.end_date or "To be agreed"

    contract = {
        "id": new_id("contract"),
        "project_id": body.project_id,
        "project_title": proj_title,
        "contractor_id": contractor["id"],
        "contractor_name": contractor.get("name"),
        "contractor_phone": contractor.get("phone"),
        "customer_id": user["user_id"],
        "customer_name": user.get("name") or "Customer",
        "customer_phone": user.get("phone") or "",
        "status": "draft",
        # editable terms
        "scope": scope,
        "price": body.price or "To be agreed",
        "start_date": start,
        "end_date": end,
        "deposit_percent": max(0, min(100, body.deposit_percent)) if body.deposit_percent is not None else 30,
        "payment_terms": body.payment_terms or "Deposit on start, balance due on completion.",
        "materials": body.materials or "Materials included in the price unless stated otherwise.",
        "warranty": body.warranty or "12 months workmanship guarantee.",
        "site_address": body.site_address or user.get("address") or user.get("postcode") or "",
        "notes": body.notes or "",
        # deposit + review tracking
        "deposit_paid": False,
        "deposit_amount": None,
        "deposit_session_id": None,
        "reviewed": False,
        "review_dismissed": False,
        # quote
        "quote_status": "none",  # none | proposed | accepted | declined
        "quote_amount": None,
        "quote_items": [],
        "quote_note": "",
        "quote_proposed_at": None,
        "quote_decided_at": None,
        # signatures
        "customer_signed": False,
        "customer_signature": None,
        "customer_signed_at": None,
        "contractor_signed": False,
        "contractor_signature": None,
        "contractor_signed_at": None,
        # discussion + job tracker
        "messages": [],
        "stages": [{"label": s, "done": False, "note": "", "updated_at": None} for s in DEFAULT_STAGES],
        "progress_index": 0,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.contracts.insert_one(contract)
    return {"contract": public_contract(contract), "clauses": [{"label": l, "text": t} for l, t in STANDARD_CLAUSES]}


@api_router.get("/contracts")
async def list_contracts(user: dict = Depends(get_current_user)):
    if user.get("role") == "admin":
        q = {}
    elif user.get("role") == "contractor":
        q = {"contractor_id": {"$in": await owned_contractor_ids(user)}}
    else:
        q = {"customer_id": user["user_id"]}
    docs = await db.contracts.find(q, {"_id": 0, "messages": 0}).sort("updated_at", -1).to_list(200)
    return {"contracts": docs}


@api_router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    return {"contract": public_contract(c), "clauses": [{"label": l, "text": t} for l, t in STANDARD_CLAUSES]}


@api_router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, body: ContractUpdate, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if _fully_signed(c):
        raise HTTPException(status_code=400, detail="This agreement is signed by both parties and can no longer be edited.")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"contract": public_contract(c)}
    if "deposit_percent" in updates:
        updates["deposit_percent"] = max(0, min(100, int(updates["deposit_percent"])))
    # editing terms invalidates any prior signature so both re-confirm
    updates.update({
        "customer_signed": False, "customer_signature": None, "customer_signed_at": None,
        "contractor_signed": False, "contractor_signature": None, "contractor_signed_at": None,
        "status": "draft", "updated_at": now_iso(),
    })
    await db.contracts.update_one({"id": contract_id}, {"$set": updates})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.post("/contracts/{contract_id}/messages")
async def contract_message(contract_id: str, body: ContractMessage, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Message is empty")
    role = "customer" if c.get("customer_id") == user["user_id"] else "contractor"
    msg = {
        "id": new_id("cmsg"),
        "sender_id": user["user_id"],
        "sender_name": user.get("name") or ("Customer" if role == "customer" else "Contractor"),
        "sender_role": role,
        "text": body.text.strip(),
        "created_at": now_iso(),
    }
    await db.contracts.update_one({"id": contract_id}, {"$push": {"messages": msg}, "$set": {"updated_at": now_iso()}})
    return {"message": msg}


@api_router.post("/contracts/{contract_id}/sign")
async def sign_contract(contract_id: str, body: ContractSign, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if not body.agree or not body.full_name.strip():
        raise HTTPException(status_code=400, detail="Type your full name to sign")
    is_customer = c.get("customer_id") == user["user_id"]
    now = now_iso()
    if is_customer:
        updates = {"customer_signed": True, "customer_signature": body.full_name.strip(), "customer_signed_at": now}
    else:
        # contractor / admin signs the contractor side
        updates = {"contractor_signed": True, "contractor_signature": body.full_name.strip(), "contractor_signed_at": now}

    merged = {**c, **updates}
    if _fully_signed(merged):
        updates["status"] = "active"
        # first stage auto-complete on signature
        stages = c.get("stages") or []
        if stages and not stages[0].get("done"):
            stages[0]["done"] = True
            stages[0]["updated_at"] = now
            updates["stages"] = stages
            updates["progress_index"] = 1
    else:
        updates["status"] = "awaiting_signatures"
    updates["updated_at"] = now
    await db.contracts.update_one({"id": contract_id}, {"$set": updates})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.post("/contracts/{contract_id}/stage")
async def update_stage(contract_id: str, body: StageUpdate, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="Only the contractor can update job progress")
    c = await _contract_or_404(contract_id, user)
    if not _fully_signed(c):
        raise HTTPException(status_code=400, detail="Both parties must sign before the job can start")
    stages = c.get("stages") or []
    idx = body.stage_index
    if idx < 0 or idx >= len(stages):
        raise HTTPException(status_code=400, detail="Invalid stage")
    now = now_iso()
    # mark all stages up to idx as done, later ones not done (allows moving back/forward)
    for i, s in enumerate(stages):
        s["done"] = i <= idx
        if i == idx:
            s["updated_at"] = now
            if body.note is not None:
                s["note"] = body.note.strip()
    progress_index = idx + 1
    status = "completed" if progress_index >= len(stages) else "active"
    await db.contracts.update_one(
        {"id": contract_id},
        {"$set": {"stages": stages, "progress_index": progress_index, "status": status, "updated_at": now}},
    )
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


async def _resolve_user_from_token(token: Optional[str]) -> dict:
    user = await resolve_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.get("/contracts/{contract_id}/pdf")
async def contract_pdf(contract_id: str, token: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    tok = token
    if not tok and authorization and authorization.startswith("Bearer "):
        tok = authorization[7:]
    user = await _resolve_user_from_token(tok)
    c = await _contract_or_404(contract_id, user)

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors as rlcolors

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=20, textColor=rlcolors.HexColor("#2C352E"))
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, textColor=rlcolors.HexColor("#4A7C59"), spaceBefore=10)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=15, textColor=rlcolors.HexColor("#2C352E"))
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, textColor=rlcolors.HexColor("#7A857C"))

    story = []
    story.append(Paragraph("Glam up your Garden — Service Agreement", h1))
    story.append(Paragraph(f"Project: {c.get('project_title') or 'Garden project'}", body))
    story.append(Paragraph(f"Agreement reference: {c['id']}", small))
    story.append(Spacer(1, 8))

    def kv(label, value):
        return [Paragraph(f"<b>{label}</b>", body), Paragraph(str(value or "—"), body)]

    parties = [
        kv("Customer", f"{c.get('customer_name')}  {c.get('customer_phone') or ''}"),
        kv("Contractor", f"{c.get('contractor_name')}  {c.get('contractor_phone') or ''}"),
        kv("Site address", c.get("site_address")),
    ]
    t = Table(parties, colWidths=[45 * mm, 120 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(t)

    story.append(Paragraph("Agreed terms", h2))
    terms = [
        kv("Scope of work", c.get("scope")),
        kv("Total price", c.get("price")),
        kv("Timeline", f"{c.get('start_date')} to {c.get('end_date')}"),
        kv("Deposit", f"{c.get('deposit_percent')}% up front"),
        kv("Payment terms", c.get("payment_terms")),
        kv("Materials", c.get("materials")),
        kv("Guarantee", c.get("warranty")),
    ]
    if c.get("notes"):
        terms.append(kv("Extra notes", c.get("notes")))
    tt = Table(terms, colWidths=[45 * mm, 120 * mm])
    tt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                            ("LINEBELOW", (0, 0), (-1, -1), 0.3, rlcolors.HexColor("#E6EBE4"))]))
    story.append(tt)

    if c.get("quote_items"):
        story.append(Paragraph("Quote breakdown", h2))
        rows = [[Paragraph(f"<b>{it.get('label')}</b>", body), Paragraph(_fmt_price(it.get('amount', 0)), body)] for it in c.get("quote_items", [])]
        rows.append([Paragraph("<b>Total</b>", body), Paragraph(_fmt_price(c.get("quote_amount") or 0), body)])
        qt = Table(rows, colWidths=[120 * mm, 45 * mm])
        qt.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                                ("LINEBELOW", (0, 0), (-1, -2), 0.3, rlcolors.HexColor("#E6EBE4")),
                                ("LINEABOVE", (0, -1), (-1, -1), 0.6, rlcolors.HexColor("#4A7C59"))]))
        story.append(qt)
    for label, text in STANDARD_CLAUSES:
        story.append(Paragraph(f"<b>{label}.</b> {text}", body))
        story.append(Spacer(1, 3))

    story.append(Paragraph("Signatures", h2))
    cust = f"{c.get('customer_signature')} — signed {(c.get('customer_signed_at') or '')[:10]}" if c.get("customer_signed") else "Not signed"
    pro = f"{c.get('contractor_signature')} — signed {(c.get('contractor_signed_at') or '')[:10]}" if c.get("contractor_signed") else "Not signed"
    sig = Table([kv("Customer signature", cust), kv("Contractor signature", pro)], colWidths=[45 * mm, 120 * mm])
    sig.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(sig)
    if c.get("deposit_paid"):
        story.append(Spacer(1, 6))
        story.append(Paragraph(f"Deposit of £{c.get('deposit_amount'):.2f} paid.", body))
    story.append(Spacer(1, 14))
    story.append(Paragraph("This document is a record generated by the Glam up your Garden app. It does not affect either party's statutory rights.", small))

    doc.build(story)
    buf.seek(0)
    filename = f"agreement-{c['id']}.pdf"
    return Response(content=buf.read(), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={filename}"})


def _fmt_price(amount: float) -> str:
    return f"£{amount:,.0f}" if float(amount).is_integer() else f"£{amount:,.2f}"


@api_router.post("/contracts/{contract_id}/quote")
async def submit_quote(contract_id: str, body: QuoteSubmit, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    is_pro = user.get("role") == "admin" or (user.get("role") == "contractor" and c.get("contractor_id") in await owned_contractor_ids(user))
    if not is_pro:
        raise HTTPException(status_code=403, detail="Only the contractor can submit a quote")
    if c.get("deposit_paid"):
        raise HTTPException(status_code=400, detail="Deposit already paid — quote is locked")
    items = [{"label": i.label.strip(), "amount": round(float(i.amount), 2)} for i in body.items if i.label.strip()]
    total = body.amount if body.amount is not None else sum(i["amount"] for i in items)
    if total is None or total <= 0:
        raise HTTPException(status_code=400, detail="Enter a quote total or line items")
    total = round(float(total), 2)
    now = now_iso()
    await db.contracts.update_one({"id": contract_id}, {"$set": {
        "quote_status": "proposed",
        "quote_amount": total,
        "quote_items": items,
        "quote_note": (body.note or "").strip(),
        "quote_proposed_at": now,
        "quote_decided_at": None,
        "price": _fmt_price(total),
        "updated_at": now,
    }})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.post("/contracts/{contract_id}/quote/respond")
async def respond_quote(contract_id: str, body: QuoteRespond, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if c.get("customer_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the customer can respond to the quote")
    if c.get("quote_status") != "proposed":
        raise HTTPException(status_code=400, detail="There is no quote awaiting your response")
    now = now_iso()
    await db.contracts.update_one({"id": contract_id}, {"$set": {
        "quote_status": "accepted" if body.accept else "declined",
        "quote_decided_at": now,
        "updated_at": now,
    }})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


def _deposit_ready(c: dict) -> bool:
    # Deposit unlocks once the customer accepts the quote, or (legacy) once both sign.
    return c.get("quote_status") == "accepted" or _fully_signed(c)


def _contract_deposit_amount(c: dict) -> Optional[float]:
    amt = _parse_amount(c.get("price") or "")
    if amt is None or amt <= 0:
        return None
    pct = c.get("deposit_percent") or 0
    return round(amt * pct / 100.0, 2)


@api_router.post("/contracts/{contract_id}/deposit")
async def start_deposit(contract_id: str, body: DepositRequest, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if c.get("customer_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the customer pays the deposit")
    if not _deposit_ready(c):
        raise HTTPException(status_code=400, detail="Accept the contractor's quote before paying the deposit")
    if c.get("deposit_paid"):
        raise HTTPException(status_code=400, detail="Deposit already paid")
    amount = _contract_deposit_amount(c)
    if amount is None:
        raise HTTPException(status_code=400, detail="Set a numeric total price (e.g. £2400) before paying a deposit")
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Payments not configured")

    origin = body.origin.rstrip("/")
    success_url = f"{origin}/contract/{contract_id}?deposit=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/contract/{contract_id}?deposit=cancel"

    if _real_stripe():
        session = await run_in_threadpool(
            lambda: _stripe_sdk.checkout.Session.create(
                mode="payment",
                line_items=[{
                    "price_data": {
                        "currency": "gbp",
                        "product_data": {"name": f"Deposit — {c.get('project_title') or 'Garden project'}"},
                        "unit_amount": int(round(amount * 100)),
                    },
                    "quantity": 1,
                }],
                success_url=success_url,
                cancel_url=cancel_url,
                payment_intent_data={"transfer_group": contract_id, "metadata": {"contract_id": contract_id, "kind": "deposit"}},
                metadata={"contract_id": contract_id, "user_id": user["user_id"], "kind": "deposit"},
            )
        )
        session_id, session_url = session["id"], session["url"]
    else:
        stripe = StripeCheckout(api_key=STRIPE_API_KEY)
        req = CheckoutSessionRequest(
            amount=float(amount),
            currency="gbp",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"contract_id": contract_id, "user_id": user["user_id"], "kind": "deposit"},
        )
        session = await stripe.create_checkout_session(req)
        session_id, session_url = session.session_id, session.url

    await db.payment_transactions.insert_one({
        "id": new_id("pay"),
        "session_id": session_id,
        "contract_id": contract_id,
        "user_id": user["user_id"],
        "amount": float(amount),
        "currency": "gbp",
        "payment_status": "initiated",
        "status": "open",
        "created_at": now_iso(),
    })
    await db.contracts.update_one({"id": contract_id}, {"$set": {"deposit_amount": float(amount), "deposit_session_id": session_id}})
    return {"url": session_url, "session_id": session_id, "amount": float(amount)}


@api_router.get("/payments/status/{session_id}")
async def payment_status(session_id: str, user: dict = Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Payment not found")
    if _real_stripe():
        session = await run_in_threadpool(lambda: _stripe_sdk.checkout.Session.retrieve(session_id))
        pay_status = session.get("payment_status")
        stat = session.get("status")
        amount_total = session.get("amount_total")
        currency = session.get("currency")
        charge_id = None
        if pay_status == "paid" and session.get("payment_intent"):
            pi = await run_in_threadpool(lambda: _stripe_sdk.PaymentIntent.retrieve(session["payment_intent"]))
            charge_id = pi.get("latest_charge")
    else:
        stripe = StripeCheckout(api_key=STRIPE_API_KEY)
        status = await stripe.get_checkout_status(session_id)
        pay_status, stat, amount_total, currency, charge_id = status.payment_status, status.status, status.amount_total, status.currency, None

    updates = {"payment_status": pay_status, "status": stat}
    if pay_status == "paid" and tx.get("payment_status") != "paid":
        updates["paid_at"] = now_iso()
        if charge_id:
            updates["charge_id"] = charge_id
        cset = {"deposit_paid": True}
        if charge_id:
            cset["deposit_charge_id"] = charge_id
        await db.contracts.update_one({"id": tx["contract_id"]}, {"$set": cset})
    await db.payment_transactions.update_one({"session_id": session_id}, {"$set": updates})
    return {"payment_status": pay_status, "status": stat, "amount_total": amount_total, "currency": currency}


# ---------------------------------------------------------------------------
# Stripe Connect: contractor payout onboarding + admin fund release
# ---------------------------------------------------------------------------
DEFAULT_FEE_PERCENT = 10.0


async def _platform_fee_percent() -> float:
    s = await db.settings.find_one({"id": "global"})
    if s and s.get("platform_fee_percent") is not None:
        return float(s["platform_fee_percent"])
    return DEFAULT_FEE_PERCENT


def _connect_guard():
    if not _real_stripe():
        raise HTTPException(status_code=503, detail="Contractor payouts need a real Stripe test key. Add STRIPE_CONNECT_SECRET_KEY (sk_test_...) to enable Connect onboarding & transfers.")


@api_router.post("/connect/onboard")
async def connect_onboard(body: ConnectOnboard, user: dict = Depends(get_current_user)):
    _connect_guard()
    ids = await owned_contractor_ids(user)
    if not ids:
        raise HTTPException(status_code=403, detail="Claim and get approval for a listing first")
    cid = ids[0]
    contractor = await db.contractors.find_one({"id": cid})
    account_id = contractor.get("stripe_account_id")
    if not account_id:
        account = await run_in_threadpool(lambda: _stripe_sdk.Account.create(
            type="express",
            email=user.get("email"),
            capabilities={"transfers": {"requested": True}},
            metadata={"contractor_id": cid},
        ))
        account_id = account["id"]
        await db.contractors.update_one({"id": cid}, {"$set": {"stripe_account_id": account_id, "onboarding_status": "created"}})
    origin = body.origin.rstrip("/")
    link = await run_in_threadpool(lambda: _stripe_sdk.AccountLink.create(
        account=account_id,
        refresh_url=f"{origin}/contractor-hub?connect=refresh",
        return_url=f"{origin}/contractor-hub?connect=return",
        type="account_onboarding",
    ))
    return {"url": link["url"], "account_id": account_id}


@api_router.get("/connect/status")
async def connect_status(user: dict = Depends(get_current_user)):
    ids = await owned_contractor_ids(user)
    if not ids:
        return {"connected": False, "payouts_enabled": False, "onboarded": False}
    contractor = await db.contractors.find_one({"id": ids[0]})
    account_id = contractor.get("stripe_account_id")
    if not account_id or not _real_stripe():
        return {"connected": False, "payouts_enabled": bool(contractor.get("payouts_enabled")), "onboarded": False}
    account = await run_in_threadpool(lambda: _stripe_sdk.Account.retrieve(account_id))
    payouts = bool(account.get("payouts_enabled"))
    details = bool(account.get("details_submitted"))
    await db.contractors.update_one({"id": ids[0]}, {"$set": {
        "payouts_enabled": payouts,
        "charges_enabled": bool(account.get("charges_enabled")),
        "onboarding_status": "complete" if details else "incomplete",
    }})
    return {"connected": True, "payouts_enabled": payouts, "onboarded": details,
            "currently_due": (account.get("requirements") or {}).get("currently_due", [])}


@api_router.get("/admin/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return {"platform_fee_percent": await _platform_fee_percent(), "connect_enabled": _real_stripe()}


@api_router.post("/admin/settings")
async def set_settings(body: SettingsInput, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    pct = max(0.0, min(50.0, float(body.platform_fee_percent)))
    await db.settings.update_one({"id": "global"}, {"$set": {"platform_fee_percent": pct}}, upsert=True)
    return {"platform_fee_percent": pct}


@api_router.get("/admin/releases")
async def list_releases(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    docs = await db.contracts.find(
        {"deposit_paid": True, "released": {"$ne": True}},
        {"_id": 0, "messages": 0},
    ).sort("updated_at", -1).to_list(100)
    fee_pct = await _platform_fee_percent()
    out = []
    for d in docs:
        contractor = await db.contractors.find_one({"id": d.get("contractor_id")}, {"_id": 0})
        amt = float(d.get("deposit_amount") or 0)
        fee = round(amt * fee_pct / 100.0, 2)
        out.append({
            "contract_id": d["id"],
            "project_title": d.get("project_title"),
            "customer_name": d.get("customer_name"),
            "contractor_name": d.get("contractor_name"),
            "deposit_amount": amt,
            "platform_fee": fee,
            "net_to_contractor": round(amt - fee, 2),
            "job_status": d.get("status"),
            "payouts_enabled": bool(contractor and contractor.get("payouts_enabled")),
            "has_stripe_account": bool(contractor and contractor.get("stripe_account_id")),
        })
    return {"releases": out, "fee_percent": fee_pct, "connect_enabled": _real_stripe()}


@api_router.post("/admin/contracts/{contract_id}/release")
async def release_deposit(contract_id: str, body: ReleaseInput, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    c = await db.contracts.find_one({"id": contract_id})
    if not c:
        raise HTTPException(status_code=404, detail="Contract not found")
    _connect_guard()
    if not c.get("deposit_paid"):
        raise HTTPException(status_code=400, detail="No paid deposit to release")
    if c.get("released"):
        raise HTTPException(status_code=400, detail="Deposit already released")
    contractor = await db.contractors.find_one({"id": c.get("contractor_id")})
    account_id = contractor and contractor.get("stripe_account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="Contractor hasn't connected a payout account yet")
    if not contractor.get("payouts_enabled"):
        raise HTTPException(status_code=400, detail="Contractor's payouts aren't enabled yet (onboarding incomplete)")

    amt = float(c.get("deposit_amount") or 0)
    fee_pct = body.fee_percent if body.fee_percent is not None else await _platform_fee_percent()
    fee_pct = max(0.0, min(50.0, float(fee_pct)))
    fee = round(amt * fee_pct / 100.0, 2)
    net = round(amt - fee, 2)

    kwargs = dict(
        amount=int(round(net * 100)),
        currency="gbp",
        destination=account_id,
        transfer_group=contract_id,
        metadata={"contract_id": contract_id, "kind": "deposit_release"},
    )
    if c.get("deposit_charge_id"):
        kwargs["source_transaction"] = c["deposit_charge_id"]
    transfer = await run_in_threadpool(lambda: _stripe_sdk.Transfer.create(
        idempotency_key=f"release_{contract_id}", **kwargs))
    now = now_iso()
    await db.contracts.update_one({"id": contract_id}, {"$set": {
        "released": True, "transfer_id": transfer["id"],
        "release_amount": net, "platform_fee": fee, "released_at": now, "updated_at": now,
    }})
    return {"ok": True, "transfer_id": transfer["id"], "net_to_contractor": net, "platform_fee": fee}


@api_router.get("/reminders")
async def review_reminders(user: dict = Depends(get_current_user)):
    docs = await db.contracts.find(
        {"customer_id": user["user_id"], "status": "completed", "reviewed": {"$ne": True}, "review_dismissed": {"$ne": True}},
        {"_id": 0, "messages": 0},
    ).sort("updated_at", -1).to_list(50)
    prompts = [{
        "contract_id": d["id"],
        "contractor_id": d.get("contractor_id"),
        "contractor_name": d.get("contractor_name"),
        "project_title": d.get("project_title"),
    } for d in docs]
    return {"review_prompts": prompts, "count": len(prompts)}


@api_router.post("/contracts/{contract_id}/dismiss-review")
async def dismiss_review_prompt(contract_id: str, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if c.get("customer_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your contract")
    await db.contracts.update_one({"id": contract_id}, {"$set": {"review_dismissed": True}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Polls
# ---------------------------------------------------------------------------
@api_router.get("/polls/active")
async def active_poll():
    poll = await db.polls.find_one({"active": True}, {"_id": 0})
    return {"poll": poll}


@api_router.post("/polls/{poll_id}/vote")
async def vote_poll(poll_id: str, body: VoteInput, user: dict = Depends(get_current_user)):
    poll = await db.polls.find_one({"id": poll_id})
    if not poll:
        raise HTTPException(status_code=404, detail="Not found")
    if body.option_index < 0 or body.option_index >= len(poll["options"]):
        raise HTTPException(status_code=400, detail="Invalid option")
    await db.polls.update_one({"id": poll_id}, {"$inc": {f"votes.{body.option_index}": 1}})
    doc = await db.polls.find_one({"id": poll_id}, {"_id": 0})
    return {"poll": doc}


# ---------------------------------------------------------------------------
# Visit stats
# ---------------------------------------------------------------------------
@api_router.post("/visit")
async def record_visit(authorization: Optional[str] = Header(None)):
    token = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
    user = await resolve_user(token)
    await db.visits.insert_one({
        "user_id": user["user_id"] if user else "anon",
        "at": datetime.now(timezone.utc),
    })
    total = await db.visits.count_documents({})
    return {"total_visits": total}


@api_router.get("/stats")
async def stats():
    now = datetime.now(timezone.utc)
    total = await db.visits.count_documents({})
    last_5m = await db.visits.count_documents({"at": {"$gte": now - timedelta(minutes=5)}})
    last_1h = await db.visits.count_documents({"at": {"$gte": now - timedelta(hours=1)}})
    last_24h = await db.visits.count_documents({"at": {"$gte": now - timedelta(hours=24)}})
    return {"total_visits": total, "active_5m": last_5m, "active_1h": last_1h, "active_24h": last_24h}


# ---------------------------------------------------------------------------
# AI Garden Assistant chatbot
# ---------------------------------------------------------------------------
@api_router.post("/chat")
async def chat_assistant(body: ChatInput, user: dict = Depends(get_current_user)):
    history = await db.chat_messages.find({"session_id": body.session_id, "user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(30)
    await db.chat_messages.insert_one({"session_id": body.session_id, "user_id": user["user_id"], "role": "user", "text": body.message, "created_at": now_iso()})

    context = "\n".join([f"{m['role']}: {m['text']}" for m in history[-8:]])
    system = (
        "You are 'Bloom', the friendly AI Garden Assistant for the 'Glam up your Garden' app. 🌿 "
        "You help people with garden design, plants, landscaping, maintenance, and turning their outdoor space into something beautiful. "
        "Be warm, encouraging and concise. Use the occasional garden emoji (🌸🌿🐝☀️). "
        "If asked about anything unrelated to gardens or the app, gently steer back to gardening."
    )
    try:
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=body.session_id, system_message=system)
        chat.with_model("openai", TEXT_MODEL)
        prompt = (context + "\n" if context else "") + f"user: {body.message}"
        reply = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"chat failed: {e}")
        reply = "Sorry, I'm having trouble right now. 🌱 Please try again in a moment."

    await db.chat_messages.insert_one({"session_id": body.session_id, "user_id": user["user_id"], "role": "assistant", "text": reply, "created_at": now_iso()})
    return {"reply": reply}


@api_router.get("/chat/{session_id}")
async def chat_history(session_id: str, user: dict = Depends(get_current_user)):
    msgs = await db.chat_messages.find({"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"messages": msgs}


# ---------------------------------------------------------------------------
# Member direct messaging + community rooms
# ---------------------------------------------------------------------------
class MessageCreate(BaseModel):
    recipient_id: str
    text: str = ""
    image_path: Optional[str] = None


class RoomMessageCreate(BaseModel):
    text: str = ""
    image_path: Optional[str] = None


class BlockInput(BaseModel):
    user_id: str


class ReportInput(BaseModel):
    reported_id: str
    reason: str
    context: Optional[str] = None


class PollCreate(BaseModel):
    question: str
    options: List[str]
    activate: bool = False



ROOMS = [
    {"key": "general", "name": "General", "emoji": "🌿", "desc": "Chat about anything garden"},
    {"key": "design", "name": "Design", "emoji": "🎨", "desc": "Layouts, styles & inspiration"},
    {"key": "plants", "name": "Plants", "emoji": "🌸", "desc": "What to grow & how"},
    {"key": "help", "name": "Help", "emoji": "🆘", "desc": "Ask the community"},
]
ROOM_KEYS = {r["key"] for r in ROOMS}


def conv_id(a: str, b: str) -> str:
    return "conv_" + "_".join(sorted([a, b]))


async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access only")
    return user


async def blocked_ids_for(uid: str) -> set:
    """Return set of user_ids that are blocked by me OR who blocked me."""
    out = set()
    async for b in db.blocks.find({"blocker_id": uid}, {"_id": 0, "blocked_id": 1}):
        out.add(b["blocked_id"])
    async for b in db.blocks.find({"blocked_id": uid}, {"_id": 0, "blocker_id": 1}):
        out.add(b["blocker_id"])
    return out


@api_router.get("/unread")
async def unread_count(user: dict = Depends(get_current_user)):
    count = await db.dm_messages.count_documents({"recipient_id": user["user_id"], "read": {"$ne": True}})
    return {"count": count}


@api_router.post("/block")
async def block_user(body: BlockInput, user: dict = Depends(get_current_user)):
    if body.user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    existing = await db.blocks.find_one({"blocker_id": user["user_id"], "blocked_id": body.user_id})
    if not existing:
        await db.blocks.insert_one({"blocker_id": user["user_id"], "blocked_id": body.user_id, "created_at": now_iso()})
    return {"ok": True}


@api_router.post("/unblock")
async def unblock_user(body: BlockInput, user: dict = Depends(get_current_user)):
    await db.blocks.delete_many({"blocker_id": user["user_id"], "blocked_id": body.user_id})
    return {"ok": True}


@api_router.get("/blocks")
async def my_blocks(user: dict = Depends(get_current_user)):
    docs = await db.blocks.find({"blocker_id": user["user_id"]}, {"_id": 0}).to_list(500)
    return {"blocked": [d["blocked_id"] for d in docs]}


@api_router.post("/report")
async def report_user(body: ReportInput, user: dict = Depends(get_current_user)):
    reported = await db.users.find_one({"user_id": body.reported_id}, {"_id": 0})
    report = {
        "id": new_id("rep"),
        "reporter_id": user["user_id"],
        "reporter_name": user.get("name"),
        "reported_id": body.reported_id,
        "reported_name": reported.get("name") if reported else "Unknown",
        "reason": body.reason,
        "context": body.context or "",
        "status": "open",
        "created_at": now_iso(),
    }
    await db.reports.insert_one(report)
    return {"ok": True}


@api_router.get("/members")
async def list_members(user: dict = Depends(get_current_user)):
    blocked = await blocked_ids_for(user["user_id"])
    docs = await db.users.find({"user_id": {"$ne": user["user_id"]}}, {"_id": 0}).to_list(500)
    members = [
        {
            "user_id": d["user_id"],
            "name": d.get("name"),
            "picture": d.get("picture"),
            "role": d.get("role", "customer"),
            "bio": d.get("bio", ""),
            "allow_messages": d.get("allow_messages", True),
        }
        for d in docs
        if d.get("role") != "admin" and d["user_id"] not in blocked
    ]
    return {"members": members}


@api_router.get("/conversations")
async def conversations(user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    blocked = await blocked_ids_for(uid)
    msgs = await db.dm_messages.find(
        {"$or": [{"sender_id": uid}, {"recipient_id": uid}]}, {"_id": 0}
    ).sort("created_at", 1).to_list(2000)
    convs: dict = {}
    for m in msgs:
        other = m["recipient_id"] if m["sender_id"] == uid else m["sender_id"]
        if other in blocked:
            continue
        entry = convs.setdefault(other, {"other_id": other, "last_text": "", "last_at": "", "unread": 0})
        entry["last_text"] = m["text"] or ("📷 Photo" if m.get("image_path") else "")
        entry["last_at"] = m["created_at"]
        if m["recipient_id"] == uid and not m.get("read"):
            entry["unread"] += 1
    result = []
    for other_id, entry in convs.items():
        u = await db.users.find_one({"user_id": other_id}, {"_id": 0})
        if not u:
            continue
        entry["name"] = u.get("name")
        entry["picture"] = u.get("picture")
        result.append(entry)
    result.sort(key=lambda x: x["last_at"], reverse=True)
    return {"conversations": result}


@api_router.get("/messages/{other_id}")
async def get_messages(other_id: str, user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    cid = conv_id(uid, other_id)
    msgs = await db.dm_messages.find({"conversation_id": cid}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    await db.dm_messages.update_many(
        {"conversation_id": cid, "recipient_id": uid, "read": {"$ne": True}}, {"$set": {"read": True}}
    )
    other = await db.users.find_one({"user_id": other_id}, {"_id": 0})
    other_pub = {"user_id": other_id, "name": other.get("name"), "picture": other.get("picture")} if other else None
    return {"messages": msgs, "other": other_pub}


@api_router.post("/messages")
async def send_message(body: MessageCreate, user: dict = Depends(get_current_user)):
    if not body.text.strip() and not body.image_path:
        raise HTTPException(status_code=400, detail="Empty message")
    recipient = await db.users.find_one({"user_id": body.recipient_id})
    if not recipient:
        raise HTTPException(status_code=404, detail="Member not found")
    blocked = await blocked_ids_for(user["user_id"])
    if body.recipient_id in blocked:
        raise HTTPException(status_code=403, detail="You can't message this member")
    if not recipient.get("allow_messages", True):
        raise HTTPException(status_code=403, detail="This member has turned off messages")
    msg = {
        "id": new_id("dm"),
        "conversation_id": conv_id(user["user_id"], body.recipient_id),
        "sender_id": user["user_id"],
        "recipient_id": body.recipient_id,
        "text": body.text.strip(),
        "image_path": body.image_path,
        "read": False,
        "created_at": now_iso(),
    }
    await db.dm_messages.insert_one(msg)
    msg.pop("_id", None)
    return {"message": msg}


@api_router.get("/rooms")
async def list_rooms(user: dict = Depends(get_current_user)):
    out = []
    for r in ROOMS:
        count = await db.room_messages.count_documents({"room": r["key"]})
        last = await db.room_messages.find({"room": r["key"]}, {"_id": 0}).sort("created_at", -1).to_list(1)
        out.append({**r, "message_count": count, "last_text": last[0]["text"] if last else None})
    return {"rooms": out}


@api_router.get("/rooms/{room}/messages")
async def room_messages(room: str, user: dict = Depends(get_current_user)):
    if room not in ROOM_KEYS:
        raise HTTPException(status_code=404, detail="Room not found")
    blocked = await blocked_ids_for(user["user_id"])
    msgs = await db.room_messages.find({"room": room}, {"_id": 0}).sort("created_at", 1).to_list(500)
    msgs = [m for m in msgs if m.get("sender_id") not in blocked]
    return {"messages": msgs}


@api_router.post("/rooms/{room}/messages")
async def post_room_message(room: str, body: RoomMessageCreate, user: dict = Depends(get_current_user)):
    if room not in ROOM_KEYS:
        raise HTTPException(status_code=404, detail="Room not found")
    if not body.text.strip() and not body.image_path:
        raise HTTPException(status_code=400, detail="Empty message")
    msg = {
        "id": new_id("rm"),
        "room": room,
        "sender_id": user["user_id"],
        "sender_name": user.get("name") or "Gardener",
        "sender_picture": user.get("picture"),
        "text": body.text.strip(),
        "image_path": body.image_path,
        "created_at": now_iso(),
    }
    await db.room_messages.insert_one(msg)
    msg.pop("_id", None)
    return {"message": msg}


# ---------------------------------------------------------------------------
# Admin dashboard
# ---------------------------------------------------------------------------
@api_router.get("/admin/overview")
async def admin_overview(admin: dict = Depends(get_admin_user)):
    now = datetime.now(timezone.utc)

    async def active_since(delta):
        ids = await db.visits.distinct("user_id", {"at": {"$gte": now - delta}, "user_id": {"$ne": "anon"}})
        return len(ids)

    total_users = await db.users.count_documents({"role": {"$ne": "admin"}})
    total_projects = await db.projects.count_documents({})
    total_designs_docs = await db.projects.find({}, {"_id": 0, "designs": 1}).to_list(5000)
    total_designs = sum(len(p.get("designs", [])) for p in total_designs_docs)
    total_posts = await db.wall_posts.count_documents({})
    total_dms = await db.dm_messages.count_documents({})
    total_room = await db.room_messages.count_documents({})
    active_project_owners = len(await db.projects.distinct("owner_id", {"updated_at": {"$gte": (now - timedelta(hours=24)).isoformat()}}))

    return {
        "visitors": {
            "total": await db.visits.count_documents({}),
            "active_5m": await db.visits.count_documents({"at": {"$gte": now - timedelta(minutes=5)}}),
            "active_1h": await db.visits.count_documents({"at": {"$gte": now - timedelta(hours=1)}}),
            "active_24h": await db.visits.count_documents({"at": {"$gte": now - timedelta(hours=24)}}),
        },
        "active_users": {
            "last_5m": await active_since(timedelta(minutes=5)),
            "last_1h": await active_since(timedelta(hours=1)),
            "last_24h": await active_since(timedelta(hours=24)),
        },
        "totals": {
            "users": total_users,
            "projects": total_projects,
            "designs": total_designs,
            "wall_posts": total_posts,
            "direct_messages": total_dms,
            "room_messages": total_room,
            "active_projects_24h": active_project_owners,
        },
    }


@api_router.get("/admin/projects")
async def admin_projects(admin: dict = Depends(get_admin_user)):
    projects = await db.projects.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    owners = {}
    out = []
    for p in projects:
        oid = p["owner_id"]
        if oid not in owners:
            u = await db.users.find_one({"user_id": oid}, {"_id": 0})
            owners[oid] = u or {}
        u = owners[oid]
        out.append({
            "id": p["id"],
            "title": p["title"],
            "owner_name": u.get("name", "Unknown"),
            "owner_email": u.get("email", ""),
            "owner_phone": u.get("phone", ""),
            "owner_address": u.get("address", ""),
            "owner_postcode": u.get("postcode", ""),
            "design_count": len(p.get("designs", [])),
            "original_path": p.get("original_path"),
            "latest_image": (p["designs"][-1]["image_path"] if p.get("designs") else None),
            "updated_at": p.get("updated_at"),
        })
    return {"projects": out}


@api_router.get("/admin/polls")
async def admin_polls(admin: dict = Depends(get_admin_user)):
    polls = await db.polls.find({}, {"_id": 0}).to_list(100)
    return {"polls": polls}


@api_router.post("/admin/polls/{poll_id}/activate")
async def activate_poll(poll_id: str, admin: dict = Depends(get_admin_user)):
    poll = await db.polls.find_one({"id": poll_id})
    if not poll:
        raise HTTPException(status_code=404, detail="Not found")
    await db.polls.update_many({}, {"$set": {"active": False}})
    await db.polls.update_one({"id": poll_id}, {"$set": {"active": True}})
    doc = await db.polls.find_one({"id": poll_id}, {"_id": 0})
    return {"poll": doc}


@api_router.post("/admin/polls")
async def create_poll(body: PollCreate, admin: dict = Depends(get_admin_user)):
    opts = [o.strip() for o in body.options if o.strip()]
    if not body.question.strip() or len(opts) < 2:
        raise HTTPException(status_code=400, detail="Need a question and at least 2 options")
    poll = {
        "id": new_id("poll"),
        "question": body.question.strip(),
        "options": opts,
        "votes": [0] * len(opts),
        "active": False,
        "week": datetime.now(timezone.utc).isocalendar()[1],
        "created_at": now_iso(),
    }
    await db.polls.insert_one(poll)
    if body.activate:
        await db.polls.update_many({"id": {"$ne": poll["id"]}}, {"$set": {"active": False}})
        await db.polls.update_one({"id": poll["id"]}, {"$set": {"active": True}})
        poll["active"] = True
    poll.pop("_id", None)
    return {"poll": poll}


@api_router.delete("/admin/polls/{poll_id}")
async def delete_poll(poll_id: str, admin: dict = Depends(get_admin_user)):
    poll = await db.polls.find_one({"id": poll_id})
    if not poll:
        raise HTTPException(status_code=404, detail="Not found")
    if poll.get("active"):
        raise HTTPException(status_code=400, detail="Cannot delete the active poll")
    await db.polls.delete_one({"id": poll_id})
    return {"ok": True}


@api_router.get("/admin/reports")
async def admin_reports(admin: dict = Depends(get_admin_user)):
    docs = await db.reports.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for r in docs:
        u = await db.users.find_one({"user_id": r.get("reported_id")}, {"_id": 0})
        r["reported_status"] = u.get("status", "active") if u else "unknown"
    return {"reports": docs}


@api_router.post("/admin/reports/{report_id}/action")
async def report_action(report_id: str, body: ReportActionInput, admin: dict = Depends(get_admin_user)):
    report = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    action = body.action
    if action not in ("warn", "suspend", "clear"):
        raise HTTPException(status_code=400, detail="Invalid action")
    reported_id = report.get("reported_id")
    if action == "warn":
        await db.users.update_one({"user_id": reported_id}, {"$set": {"status": "warned"}})
        await db.reports.update_one({"id": report_id}, {"$set": {"status": "resolved", "resolution": "warned"}})
    elif action == "suspend":
        await db.users.update_one({"user_id": reported_id}, {"$set": {"status": "suspended"}})
        await db.user_sessions.delete_many({"user_id": reported_id})
        await db.reports.update_one({"id": report_id}, {"$set": {"status": "resolved", "resolution": "suspended"}})
    else:  # clear
        await db.users.update_one({"user_id": reported_id}, {"$set": {"status": "active"}})
        await db.reports.update_one({"id": report_id}, {"$set": {"status": "resolved", "resolution": "cleared"}})
    doc = await db.reports.find_one({"id": report_id}, {"_id": 0})
    return {"report": doc}


# ---------------------------------------------------------------------------
# Maps & location (postcode geocoding + distances)
# ---------------------------------------------------------------------------
import math

_geo_cache: dict = {}


async def geocode_postcode(postcode: Optional[str]):
    if not postcode:
        return None
    pc = postcode.upper().strip()
    if not pc:
        return None
    if pc in _geo_cache:
        return _geo_cache[pc]
    compact = pc.replace(" ", "")
    outcode = pc.split(" ")[0] if " " in pc else compact
    try:
        async with httpx.AsyncClient(timeout=8) as http:
            r = await http.get(f"https://api.postcodes.io/postcodes/{compact}")
            if r.status_code == 200:
                res = r.json().get("result") or {}
                if res.get("latitude") is not None:
                    coord = {"lat": res["latitude"], "lng": res["longitude"]}
                    _geo_cache[pc] = coord
                    return coord
            r2 = await http.get(f"https://api.postcodes.io/outcodes/{outcode}")
            if r2.status_code == 200:
                res = r2.json().get("result") or {}
                if res.get("latitude") is not None:
                    coord = {"lat": res["latitude"], "lng": res["longitude"]}
                    _geo_cache[pc] = coord
                    return coord
    except Exception as e:
        logger.warning(f"geocode failed for {pc}: {e}")
    return None


def haversine_km(a: dict, b: dict) -> float:
    R = 6371.0
    dlat = math.radians(b["lat"] - a["lat"])
    dlng = math.radians(b["lng"] - a["lng"])
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return round(2 * R * math.asin(math.sqrt(h)), 1)


def zoom_for(max_km: float) -> int:
    if max_km <= 0:
        return 11
    for limit, z in [(3, 12), (10, 11), (25, 10), (60, 9), (150, 8), (400, 7)]:
        if max_km <= limit:
            return z
    return 6


def static_map_url(pins: list, center: Optional[dict]) -> Optional[str]:
    if not pins:
        return None
    lats = [p["lat"] for p in pins]
    lngs = [p["lng"] for p in pins]
    c = center or {"lat": sum(lats) / len(lats), "lng": sum(lngs) / len(lngs)}
    max_km = 0.0
    for p in pins:
        max_km = max(max_km, haversine_km(c, p))
    z = zoom_for(max_km)
    parts = [
        "https://staticmap.openstreetmap.de/staticmap.php",
        f"?center={c['lat']},{c['lng']}",
        f"&zoom={z}",
        "&size=640x360",
        "&maptype=mapnik",
    ]
    for p in pins:
        style = p.get("style", "red-pushpin")
        parts.append(f"&markers={p['lat']},{p['lng']},{style}")
    return "".join(parts)


@api_router.get("/map/contractors")
async def map_contractors(user: dict = Depends(get_current_user)):
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    my_coord = None
    if me and me.get("lat") is not None:
        my_coord = {"lat": me["lat"], "lng": me["lng"]}
    elif me and me.get("postcode"):
        my_coord = await geocode_postcode(me["postcode"])
        if my_coord:
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"lat": my_coord["lat"], "lng": my_coord["lng"]}})

    cons = await db.contractors.find({}, {"_id": 0}).to_list(200)
    pins = []
    out = []
    for c in cons:
        coord = None
        if c.get("lat") is not None:
            coord = {"lat": c["lat"], "lng": c["lng"]}
        elif c.get("postcode"):
            coord = await geocode_postcode(c["postcode"])
            if coord:
                await db.contractors.update_one({"id": c["id"]}, {"$set": {"lat": coord["lat"], "lng": coord["lng"]}})
        item = {**c, "lat": coord["lat"] if coord else None, "lng": coord["lng"] if coord else None, "distance_km": None}
        coverage_miles = c.get("coverage_miles", 25)
        item["coverage_miles"] = coverage_miles
        item["reachable"] = False
        if coord and my_coord:
            item["distance_km"] = haversine_km(my_coord, coord)
            item["reachable"] = item["distance_km"] <= coverage_miles * 1.60934
        if coord:
            pins.append({"lat": coord["lat"], "lng": coord["lng"], "style": "green-pushpin"})
        out.append(item)

    out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] if x["distance_km"] is not None else 0))
    if my_coord:
        pins.append({"lat": my_coord["lat"], "lng": my_coord["lng"], "style": "red-pushpin"})
    return {"me": my_coord, "contractors": out, "map_url": static_map_url(pins, my_coord)}


@api_router.get("/alerts/nearby")
async def nearby_alerts(user: dict = Depends(get_current_user)):
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    my_coord = None
    if me and me.get("lat") is not None:
        my_coord = {"lat": me["lat"], "lng": me["lng"]}
    elif me and me.get("postcode"):
        my_coord = await geocode_postcode(me["postcode"])
        if my_coord:
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"lat": my_coord["lat"], "lng": my_coord["lng"]}})
    if not my_coord:
        return {"alerts": []}

    cons = await db.contractors.find({}, {"_id": 0}).to_list(200)
    alerts = []
    for c in cons:
        coord = None
        if c.get("lat") is not None:
            coord = {"lat": c["lat"], "lng": c["lng"]}
        elif c.get("postcode"):
            coord = await geocode_postcode(c["postcode"])
        if not coord:
            continue
        dist = haversine_km(my_coord, coord)
        coverage_km = c.get("coverage_miles", 25) * 1.60934
        if c.get("rating", 0) >= 4.7 and dist <= coverage_km:
            alerts.append({
                "id": c["id"], "name": c["name"], "tagline": c.get("tagline", ""),
                "rating": c.get("rating"), "image": c.get("image"),
                "distance_km": dist, "coverage_miles": c.get("coverage_miles", 25),
            })
    alerts.sort(key=lambda x: x["distance_km"])
    return {"alerts": alerts}


@api_router.get("/admin/map")
async def admin_map(admin: dict = Depends(get_admin_user)):
    owner_ids = await db.projects.distinct("owner_id")
    customers = []
    pins = []
    for oid in owner_ids:
        u = await db.users.find_one({"user_id": oid}, {"_id": 0})
        if not u:
            continue
        coord = None
        if u.get("lat") is not None:
            coord = {"lat": u["lat"], "lng": u["lng"]}
        elif u.get("postcode"):
            coord = await geocode_postcode(u["postcode"])
            if coord:
                await db.users.update_one({"user_id": oid}, {"$set": {"lat": coord["lat"], "lng": coord["lng"]}})
        pc = await db.projects.count_documents({"owner_id": oid})
        customers.append({"name": u.get("name"), "postcode": u.get("postcode"), "phone": u.get("phone"),
                          "lat": coord["lat"] if coord else None, "lng": coord["lng"] if coord else None, "project_count": pc})
        if coord:
            pins.append({"lat": coord["lat"], "lng": coord["lng"], "style": "red-pushpin"})

    cons = await db.contractors.find({}, {"_id": 0}).to_list(200)
    contractors = []
    for c in cons:
        coord = None
        if c.get("lat") is not None:
            coord = {"lat": c["lat"], "lng": c["lng"]}
        elif c.get("postcode"):
            coord = await geocode_postcode(c["postcode"])
        contractors.append({"name": c.get("name"), "postcode": c.get("postcode"),
                            "lat": coord["lat"] if coord else None, "lng": coord["lng"] if coord else None})
        if coord:
            pins.append({"lat": coord["lat"], "lng": coord["lng"], "style": "green-pushpin"})

    return {"customers": customers, "contractors": contractors, "map_url": static_map_url(pins, None)}



# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------
SEED_CONTRACTORS = [
    {"name": "GreenThumb Landscapes", "tagline": "Award-winning garden transformations", "services": ["Landscaping", "Patios", "Planting"], "phone": "+44 20 7946 0123", "rating": 4.8, "review_count": 0, "location": "London", "postcode": "SW1A", "image": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=80"},
    {"name": "Blossom & Bee Gardens", "tagline": "Wildlife-friendly, pollinator gardens 🐝", "services": ["Wildflower meadows", "Ponds", "Planting"], "phone": "+44 161 496 0199", "rating": 4.9, "review_count": 0, "location": "Manchester", "postcode": "M1", "image": "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=400&q=80"},
    {"name": "Stone & Slate Patios", "tagline": "Premium paving and hard landscaping", "services": ["Patios", "Driveways", "Decking"], "phone": "+44 121 496 0177", "rating": 4.6, "review_count": 0, "location": "Birmingham", "postcode": "B1", "image": "https://images.unsplash.com/photo-1558904541-efa843a96f01?w=400&q=80"},
    {"name": "Tranquil Waters Ltd", "tagline": "Water features & serene retreats 💧", "services": ["Ponds", "Fountains", "Lighting"], "phone": "+44 113 496 0155", "rating": 4.7, "review_count": 0, "location": "Leeds", "postcode": "LS1", "image": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=400&q=80"},
]


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
    except Exception as e:
        logger.warning(f"index warn: {e}")
    try:
        await run_in_threadpool(init_storage)
        logger.info("storage initialized")
    except Exception as e:
        logger.warning(f"storage init failed: {e}")
    if await db.contractors.count_documents({}) == 0:
        for c in SEED_CONTRACTORS:
            await db.contractors.insert_one({**c, "id": new_id("con")})
        logger.info("seeded contractors")

    # Seed default admin account
    if await db.users.count_documents({"role": "admin"}) == 0:
        admin_hash = bcrypt.hashpw("GlamAdmin2026!".encode(), bcrypt.gensalt()).decode()
        try:
            await db.users.insert_one({
                "user_id": new_id("user"),
                "name": "Garden Admin",
                "email": "admin@glamgarden.app",
                "password_hash": admin_hash,
                "role": "admin",
                "picture": None,
                "bio": "",
                "allow_messages": False,
                "created_at": now_iso(),
            })
            logger.info("seeded admin user")
        except Exception as e:
            logger.warning(f"admin seed warn: {e}")

    # Seed preset polls (only one active at a time)
    if await db.polls.count_documents({}) == 0:
        presets = [
            {"question": "What's the #1 upgrade you want for your garden this season? 🌸",
             "options": ["A cosy patio area", "More flowers & colour", "A water feature", "Better lighting"]},
            {"question": "Which garden vibe is calling your name? 🌿",
             "options": ["Tranquil zen retreat", "Wild cottage garden", "Sleek & modern", "Family fun space"]},
            {"question": "What helps most when planning a garden? ☀️",
             "options": ["Seeing an AI redesign", "Advice from pros", "Community ideas", "Budget planning"]},
            {"question": "Which wildlife would you love to attract? 🐝",
             "options": ["Bees & butterflies", "Birds", "Hedgehogs", "All of them!"]},
        ]
        for i, p in enumerate(presets):
            await db.polls.insert_one({
                "id": new_id("poll"),
                "question": p["question"],
                "options": p["options"],
                "votes": [0] * len(p["options"]),
                "active": i == 0,
                "week": datetime.now(timezone.utc).isocalendar()[1],
                "created_at": now_iso(),
            })
        logger.info("seeded preset polls")


@app.on_event("shutdown")
async def shutdown():
    client.close()


@api_router.get("/")
async def root():
    return {"message": "Glam up your Garden API 🌿"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
