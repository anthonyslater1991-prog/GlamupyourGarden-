from core import *  # noqa: F401,F403

import routes_admin  # noqa: F401
import routes_ai  # noqa: F401
import routes_assistant  # noqa: F401
import routes_auth  # noqa: F401
import routes_community  # noqa: F401
import routes_contractors  # noqa: F401
import routes_contracts  # noqa: F401
import routes_engagement  # noqa: F401
import routes_geo  # noqa: F401
import routes_media  # noqa: F401
import routes_messaging  # noqa: F401
import routes_payments  # noqa: F401
import routes_projects  # noqa: F401



# ---------------------------------------------------------------------------
# App / router
# ---------------------------------------------------------------------------
app = FastAPI()


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


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
