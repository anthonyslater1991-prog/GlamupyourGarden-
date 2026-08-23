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
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import httpx
import requests
from pydantic import BaseModel, Field, EmailStr

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

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


class WallPostCreate(BaseModel):
    caption: str
    image_path: Optional[str] = None


class ReviewCreate(BaseModel):
    rating: int
    text: str


class VoteInput(BaseModel):
    option_index: int


class ChatInput(BaseModel):
    session_id: str
    message: str


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


async def generate_hotspots(changes: List[str], style: Optional[str]) -> List[dict]:
    change_text = ", ".join(changes) if changes else "general garden improvements"
    prompt = (
        f"A homeowner redesigned their garden with these changes: {change_text}. "
        f"Style: {style or 'natural'}. Suggest 4 realistic shoppable products they would buy to achieve this look. "
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
    for i, p in enumerate(products[:len(HOTSPOT_POSITIONS)]):
        retailer, base_url = random.choice(RETAILERS)
        query = (p.get("search_query") or p.get("name") or "garden").replace(" ", "+")
        pos = HOTSPOT_POSITIONS[i]
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
    notes = f" Additional notes: {body.notes}." if body.notes else ""
    prompt = (
        f"Redesign and beautify this real garden photo. Keep the same camera angle, perspective and overall layout, "
        f"but transform it into a stunning, professionally landscaped {style} garden. Apply these improvements: {change_text}.{notes} "
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

    hotspots = await generate_hotspots(body.changes, body.style)

    design = {
        "id": new_id("design"),
        "image_path": out_path,
        "changes": body.changes,
        "style": body.style,
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
        "created_at": now_iso(),
    }
    await db.reviews.insert_one(review)
    reviews = await db.reviews.find({"contractor_id": contractor_id}).to_list(1000)
    avg = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
    await db.contractors.update_one({"id": contractor_id}, {"$set": {"rating": avg, "review_count": len(reviews)}})
    review.pop("_id", None)
    return {"review": review, "rating": avg, "review_count": len(reviews)}


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
    return {"reports": docs}


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
        if coord and my_coord:
            item["distance_km"] = haversine_km(my_coord, coord)
        if coord:
            pins.append({"lat": coord["lat"], "lng": coord["lng"], "style": "green-pushpin"})
        out.append(item)

    out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] if x["distance_km"] is not None else 0))
    if my_coord:
        pins.append({"lat": my_coord["lat"], "lng": my_coord["lng"], "style": "red-pushpin"})
    return {"me": my_coord, "contractors": out, "map_url": static_map_url(pins, my_coord)}


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
