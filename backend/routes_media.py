from core import *  # noqa: F401,F403




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
