from core import *  # noqa: F401,F403




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
