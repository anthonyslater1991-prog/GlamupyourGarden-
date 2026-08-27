from core import *  # noqa: F401,F403




@api_router.post("/projects/{project_id}/redesign")
async def redesign(project_id: str, body: RedesignInput, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "owner_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.get("original_path"):
        raise HTTPException(status_code=400, detail="Project has no garden photo")

    original_bytes, _ = await run_in_threadpool(get_object, project["original_path"])
    image_b64 = base64.b64encode(original_bytes).decode("utf-8")

    prompt = build_redesign_prompt(body)

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


@api_router.post("/admin/sandbox-redesign")
async def sandbox_redesign(body: SandboxRedesignInput, user: dict = Depends(get_current_user)):
    """Admin-only AI redesign test bench. Runs the exact same Gemini flow but
    does NOT create a project or persist any design/version — it only stores the
    generated image in object storage so it can be viewed, and returns the prompt."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    if not body.original_path:
        raise HTTPException(status_code=400, detail="Upload a garden photo first")

    original_bytes, _ = await run_in_threadpool(get_object, body.original_path)
    image_b64 = base64.b64encode(original_bytes).decode("utf-8")

    prompt = build_redesign_prompt(body)

    try:
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=new_id("sbx"),
                       system_message="You are an expert garden landscape photo editor.")
        chat.with_model("gemini", IMAGE_MODEL).with_params(modalities=["image", "text"])
        msg = UserMessage(text=prompt, file_contents=[ImageContent(image_b64)])
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.error(f"sandbox redesign gen failed: {e}")
        raise HTTPException(status_code=502, detail="AI redesign failed. Please try again.")

    if not images:
        raise HTTPException(status_code=502, detail="No image was generated. Please try again.")

    img = images[0]
    out_bytes = base64.b64decode(img["data"])
    out_path = f"{APP_NAME}/sandbox/{user['user_id']}/{uuid.uuid4().hex}.png"
    await run_in_threadpool(put_object, out_path, out_bytes, "image/png")
    # index in uploads so /files can serve it — but no project/design record is created
    await db.uploads.insert_one({"path": out_path, "owner_id": user["user_id"], "content_type": "image/png", "created_at": now_iso(), "sandbox": True})

    hotspots = await generate_hotspots(body.changes + body.ornaments, body.style, body.colour_scheme, body.wishlist)

    return {"image_path": out_path, "prompt": prompt, "hotspots": hotspots}
