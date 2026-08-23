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


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class SessionInput(BaseModel):
    session_id: str


class ProfileUpdate(BaseModel):
    bio: Optional[str] = None
    allow_messages: Optional[bool] = None
    name: Optional[str] = None


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
# Seed data
# ---------------------------------------------------------------------------
SEED_CONTRACTORS = [
    {"name": "GreenThumb Landscapes", "tagline": "Award-winning garden transformations", "services": ["Landscaping", "Patios", "Planting"], "phone": "+44 20 7946 0123", "rating": 4.8, "review_count": 0, "location": "London", "image": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=80"},
    {"name": "Blossom & Bee Gardens", "tagline": "Wildlife-friendly, pollinator gardens 🐝", "services": ["Wildflower meadows", "Ponds", "Planting"], "phone": "+44 161 496 0199", "rating": 4.9, "review_count": 0, "location": "Manchester", "image": "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=400&q=80"},
    {"name": "Stone & Slate Patios", "tagline": "Premium paving and hard landscaping", "services": ["Patios", "Driveways", "Decking"], "phone": "+44 121 496 0177", "rating": 4.6, "review_count": 0, "location": "Birmingham", "image": "https://images.unsplash.com/photo-1558904541-efa843a96f01?w=400&q=80"},
    {"name": "Tranquil Waters Ltd", "tagline": "Water features & serene retreats 💧", "services": ["Ponds", "Fountains", "Lighting"], "phone": "+44 113 496 0155", "rating": 4.7, "review_count": 0, "location": "Leeds", "image": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=400&q=80"},
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
    if await db.polls.count_documents({"active": True}) == 0:
        await db.polls.insert_one({
            "id": new_id("poll"),
            "question": "What's the #1 upgrade you want for your garden this season? 🌸",
            "options": ["A cosy patio area", "More flowers & colour", "A water feature", "Better lighting"],
            "votes": [0, 0, 0, 0],
            "active": True,
            "week": datetime.now(timezone.utc).isocalendar()[1],
            "created_at": now_iso(),
        })
        logger.info("seeded poll")


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
