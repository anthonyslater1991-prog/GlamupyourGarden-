from core import *  # noqa: F401,F403




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


@api_router.post("/admin/cleanup-demo")
async def cleanup_demo(body: CleanupInput, user: dict = Depends(get_current_user)):
    """Admin-only: remove seeded/test accounts (@example.com) and all their content.
    NEVER touches the admin account or real users (e.g. real email domains like Mary's)."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Set confirm=true to run cleanup")

    # Test accounts = anyone on @example.com, excluding the admin account.
    test_users = await db.users.find(
        {"email": {"$regex": r"@example\.com$", "$options": "i"}, "role": {"$ne": "admin"}},
        {"user_id": 1, "email": 1, "_id": 0},
    ).to_list(1000)
    ids = [u["user_id"] for u in test_users]
    emails = [u["email"] for u in test_users]

    removed = {"users": 0, "projects": 0, "contracts": 0, "payments": 0,
               "wall_posts": 0, "room_messages": 0, "messages": 0, "sessions": 0, "reviews": 0,
               "visits": 0, "reports": 0}

    # Reset the visit/view counters to zero (until launch) and clear test moderation reports.
    removed["visits"] = (await db.visits.delete_many({})).deleted_count
    removed["reports"] = (await db.reports.delete_many({})).deleted_count

    if ids:
        removed["sessions"] = (await db.user_sessions.delete_many({"user_id": {"$in": ids}})).deleted_count
        removed["projects"] = (await db.projects.delete_many({"owner_id": {"$in": ids}})).deleted_count
        removed["contracts"] = (await db.contracts.delete_many({"customer_id": {"$in": ids}})).deleted_count
        removed["payments"] = (await db.payment_transactions.delete_many({"user_id": {"$in": ids}})).deleted_count
        removed["wall_posts"] = (await db.wall_posts.delete_many({"$or": [{"author_id": {"$in": ids}}, {"user_id": {"$in": ids}}]})).deleted_count
        removed["room_messages"] = (await db.room_messages.delete_many({"sender_id": {"$in": ids}})).deleted_count
        removed["messages"] = (await db.messages.delete_many({"$or": [{"sender_id": {"$in": ids}}, {"receiver_id": {"$in": ids}}]})).deleted_count
        removed["reviews"] = (await db.reviews.delete_many({"$or": [{"author_id": {"$in": ids}}, {"author_name": {"$in": emails}}]})).deleted_count
        # Free up any contractor listings claimed by test accounts (keep the listing itself)
        await db.contractors.update_many(
            {"claimed_by": {"$in": ids}},
            {"$set": {"claim_status": "unclaimed"},
             "$unset": {"claimed_by": "", "claim_user_id": "", "claim_user_name": "",
                        "stripe_account_id": "", "payouts_enabled": "", "charges_enabled": "", "onboarding_status": ""}},
        )
        removed["users"] = (await db.users.delete_many({"user_id": {"$in": ids}})).deleted_count

    # Purge obvious automation/test reviews (by tag/name) regardless of author link
    tag_removed = (await db.reviews.delete_many({"$or": [
        {"text": {"$regex": r"^\s*TEST_", "$options": "i"}},
        {"author_name": {"$in": ["Test Gardener", "Test Customer", "Automation", "QA Tester"]}},
    ]})).deleted_count
    removed["reviews"] += tag_removed

    # Recompute rating/review_count for every contractor from remaining reviews
    async for con in db.contractors.find({}, {"id": 1, "_id": 0}):
        revs = await db.reviews.find({"contractor_id": con["id"]}).to_list(1000)
        if revs:
            avg = round(sum(r["rating"] for r in revs) / len(revs), 1)
            await db.contractors.update_one({"id": con["id"]}, {"$set": {"rating": avg, "review_count": len(revs)}})
        else:
            await db.contractors.update_one({"id": con["id"]}, {"$set": {"rating": 0, "review_count": 0}})

    return {"ok": True, "removed": removed, "protected": "admin + any non-@example.com user (e.g. real customers)"}

@api_router.get("/")
async def root():
    return {"message": "Glam up your Garden API 🌿"}
