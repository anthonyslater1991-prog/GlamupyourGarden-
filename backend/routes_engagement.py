from core import *  # noqa: F401,F403




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
