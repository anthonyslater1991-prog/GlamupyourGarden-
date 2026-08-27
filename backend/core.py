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


class SandboxRedesignInput(RedesignInput):
    original_path: str


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


class CleanupInput(BaseModel):
    confirm: bool = False


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


def build_redesign_prompt(body: RedesignInput) -> str:
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
    return (
        f"Redesign and beautify this real garden photo. Keep the same camera angle, perspective and overall layout, "
        f"but transform it into a stunning, professionally landscaped {style} garden. Apply these improvements: {change_text}.{detail_text} "
        "Make it photorealistic with natural lighting, realistic colours, healthy plants, and clean finishes. "
        "The result should look like a real 'after' photo of a garden makeover."
    )


class GalleryAdd(BaseModel):
    image_path: str
    note: Optional[str] = None


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


class StyleInput(BaseModel):
    data: dict


class AssistProducts(BaseModel):
    prompt: Optional[str] = None


class ReactInput(BaseModel):
    emoji: str


class CommentInput(BaseModel):
    text: str


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


async def _resolve_user_from_token(token: Optional[str]) -> dict:
    user = await resolve_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _fmt_price(amount: float) -> str:
    return f"£{amount:,.0f}" if float(amount).is_integer() else f"£{amount:,.2f}"


def _deposit_ready(c: dict) -> bool:
    # Payments unlock once the customer accepts the quote, or (legacy) once both sign.
    return c.get("quote_status") == "accepted" or _fully_signed(c)


def _build_milestones(total: float, deposit_percent: float) -> list:
    dep = round(total * (deposit_percent or 0) / 100.0, 2)
    final = round(total - dep, 2)
    base = {"status": "unpaid", "session_id": None, "charge_id": None, "paid_at": None,
            "transfer_id": None, "released_at": None, "release_amount": None, "platform_fee": None}
    ms = [{**base, "key": "deposit", "label": "Deposit", "amount": dep}]
    if final > 0.005:
        ms.append({**base, "key": "final", "label": "Final balance", "amount": final})
    return ms


async def _ensure_milestones(c: dict) -> dict:
    if c.get("milestones"):
        return c
    total = _parse_amount(c.get("price") or "")
    if not total or total <= 0 or c.get("quote_status") != "accepted":
        return c
    ms = _build_milestones(float(total), c.get("deposit_percent") or 0)
    await db.contracts.update_one({"id": c["id"]}, {"$set": {"milestones": ms}})
    c["milestones"] = ms
    return c


async def _create_checkout(amount: float, contract_id: str, user_id: str, origin: str, name: str, milestone_key: str):
    success_url = f"{origin}/contract/{contract_id}?pay=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/contract/{contract_id}?pay=cancel"
    meta = {"contract_id": contract_id, "user_id": user_id, "milestone": milestone_key}
    if _real_stripe():
        session = await run_in_threadpool(lambda: _stripe_sdk.checkout.Session.create(
            mode="payment",
            line_items=[{"price_data": {"currency": "gbp", "product_data": {"name": name}, "unit_amount": int(round(amount * 100))}, "quantity": 1}],
            success_url=success_url, cancel_url=cancel_url,
            payment_intent_data={"transfer_group": contract_id, "metadata": meta},
            metadata=meta,
        ))
        return session["id"], session["url"]
    stripe = StripeCheckout(api_key=STRIPE_API_KEY)
    req = CheckoutSessionRequest(amount=float(amount), currency="gbp", success_url=success_url, cancel_url=cancel_url, metadata=meta)
    session = await stripe.create_checkout_session(req)
    return session.session_id, session.url


async def _pay_milestone(c: dict, key: str, origin: str, user: dict):
    if c.get("customer_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the customer pays for this job")
    if not _deposit_ready(c):
        raise HTTPException(status_code=400, detail="Accept the contractor's quote before paying")
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Payments not configured")
    c = await _ensure_milestones(c)
    ms = c.get("milestones") or []
    if not ms:
        raise HTTPException(status_code=400, detail="Set a numeric total price before paying")
    m = next((x for x in ms if x["key"] == key), None)
    if not m:
        raise HTTPException(status_code=404, detail="Payment stage not found")
    if m["status"] != "unpaid":
        raise HTTPException(status_code=400, detail=f"{m['label']} is already {m['status']}")
    if m["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Nothing to pay for this stage")
    origin = origin.rstrip("/")
    name = f"{m['label']} — {c.get('project_title') or 'Garden project'}"
    session_id, url = await _create_checkout(m["amount"], c["id"], user["user_id"], origin, name, key)
    await db.payment_transactions.insert_one({
        "id": new_id("pay"), "session_id": session_id, "contract_id": c["id"], "user_id": user["user_id"],
        "milestone_key": key, "amount": float(m["amount"]), "currency": "gbp",
        "payment_status": "initiated", "status": "open", "created_at": now_iso(),
    })
    await db.contracts.update_one({"id": c["id"], "milestones.key": key}, {"$set": {"milestones.$.session_id": session_id}})
    if key == "deposit":
        await db.contracts.update_one({"id": c["id"]}, {"$set": {"deposit_amount": float(m["amount"]), "deposit_session_id": session_id}})
    return {"url": url, "session_id": session_id, "amount": float(m["amount"])}


# ---------------------------------------------------------------------------
# Stripe Connect: contractor payout onboarding + escrow release (milestones)
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


async def _try_release(c: dict, fee_pct_override: Optional[float] = None) -> dict:
    """Release all paid, un-released milestones to the contractor. If payouts aren't
    ready yet, flag the contract as 'ready to release' so it auto-releases later."""
    c = await db.contracts.find_one({"id": c["id"]})
    paid = [m for m in (c.get("milestones") or []) if m.get("status") == "paid"]
    if not paid:
        return {"released": False, "pending": False}
    contractor = await db.contractors.find_one({"id": c.get("contractor_id")})
    ready = bool(_real_stripe() and contractor and contractor.get("payouts_enabled") and contractor.get("stripe_account_id"))
    if not ready:
        await db.contracts.update_one({"id": c["id"]}, {"$set": {"release_ready": True}})
        return {"released": False, "pending": True}
    fee_pct = fee_pct_override if fee_pct_override is not None else await _platform_fee_percent()
    fee_pct = max(0.0, min(50.0, float(fee_pct)))
    account_id = contractor["stripe_account_id"]
    for m in paid:
        fee = round(m["amount"] * fee_pct / 100.0, 2)
        net = round(m["amount"] - fee, 2)
        kwargs = dict(amount=int(round(net * 100)), currency="gbp", destination=account_id,
                      transfer_group=c["id"], metadata={"contract_id": c["id"], "milestone": m["key"], "kind": "release"})
        if m.get("charge_id"):
            kwargs["source_transaction"] = m["charge_id"]
        transfer = await run_in_threadpool(lambda kw=kwargs, mk=m["key"]: _stripe_sdk.Transfer.create(idempotency_key=f"rel_{c['id']}_{mk}", **kw))
        await db.contracts.update_one({"id": c["id"], "milestones.key": m["key"]}, {"$set": {
            "milestones.$.status": "released", "milestones.$.transfer_id": transfer["id"],
            "milestones.$.release_amount": net, "milestones.$.platform_fee": fee, "milestones.$.released_at": now_iso(),
        }})
    fresh = await db.contracts.find_one({"id": c["id"]})
    considered = [m for m in (fresh.get("milestones") or []) if m.get("status") in ("paid", "released")]
    all_released = bool(considered) and all(m.get("status") == "released" for m in considered)
    await db.contracts.update_one({"id": c["id"]}, {"$set": {"released": all_released, "release_ready": False}})
    return {"released": True, "pending": False}


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



# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------
SEED_CONTRACTORS = [
    {"name": "GreenThumb Landscapes", "tagline": "Award-winning garden transformations", "services": ["Landscaping", "Patios", "Planting"], "phone": "+44 20 7946 0123", "rating": 4.8, "review_count": 0, "location": "London", "postcode": "SW1A", "image": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=80"},
    {"name": "Blossom & Bee Gardens", "tagline": "Wildlife-friendly, pollinator gardens 🐝", "services": ["Wildflower meadows", "Ponds", "Planting"], "phone": "+44 161 496 0199", "rating": 4.9, "review_count": 0, "location": "Manchester", "postcode": "M1", "image": "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=400&q=80"},
    {"name": "Stone & Slate Patios", "tagline": "Premium paving and hard landscaping", "services": ["Patios", "Driveways", "Decking"], "phone": "+44 121 496 0177", "rating": 4.6, "review_count": 0, "location": "Birmingham", "postcode": "B1", "image": "https://images.unsplash.com/photo-1558904541-efa843a96f01?w=400&q=80"},
    {"name": "Tranquil Waters Ltd", "tagline": "Water features & serene retreats 💧", "services": ["Ponds", "Fountains", "Lighting"], "phone": "+44 113 496 0155", "rating": 4.7, "review_count": 0, "location": "Leeds", "postcode": "LS1", "image": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=400&q=80"},
]


__all__ = [name for name in dir() if not name.startswith('__')]
