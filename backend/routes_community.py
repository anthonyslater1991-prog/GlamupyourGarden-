from core import *  # noqa: F401,F403




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
