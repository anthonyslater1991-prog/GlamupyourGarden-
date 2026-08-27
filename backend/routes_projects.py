from core import *  # noqa: F401,F403





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


@api_router.post("/projects/{project_id}/gallery")
async def add_to_gallery(project_id: str, body: GalleryAdd, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "owner_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    item = {"id": new_id("gal"), "image_path": body.image_path, "note": body.note or "", "created_at": now_iso()}
    await db.projects.update_one({"id": project_id}, {"$push": {"gallery": item}, "$set": {"updated_at": now_iso()}})
    return {"item": item}


@api_router.post("/product-prices")
async def add_price(body: PriceInput, user: dict = Depends(get_current_user)):
    amount = _parse_amount(body.price)
    if amount is None:
        raise HTTPException(status_code=400, detail="Enter a valid price")
    entry = {
        "id": new_id("price"),
        "name": body.name.strip(),
        "name_key": _name_key(body.name),
        "amount": amount,
        "display": f"£{amount:.2f}".rstrip("0").rstrip(".") if amount == int(amount) else f"£{amount:.2f}",
        "retailer": body.retailer or "",
        "url": body.url or "",
        "user_id": user["user_id"],
        "user_name": user.get("name") or "A gardener",
        "created_at": now_iso(),
    }
    await db.product_prices.insert_one(entry)
    return await _price_summary(body.name)


@api_router.get("/product-prices")
async def get_prices(name: str = Query(...), user: dict = Depends(get_current_user)):
    return await _price_summary(name)


@api_router.put("/auth/style")
async def save_style(body: StyleInput, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"saved_style": body.data}})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(fresh)}


@api_router.post("/assistant/products")
async def assistant_products(body: AssistProducts, user: dict = Depends(get_current_user)):
    ask = body.prompt or "a beautiful low-maintenance garden"
    prompt = (
        f"A homeowner wants: {ask}. Suggest 6 specific, real, buyable garden products/items (with a brand or clear type) "
        "they could add. Return ONLY a JSON array of short product name strings, e.g. "
        "[\"Rattan corner sofa set\", \"Solar festoon lights\"]. No markdown, no extra text."
    )
    items: List[str] = []
    try:
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=new_id("ap"),
                       system_message="You are a garden product expert. Reply with strict JSON only.")
        chat.with_model("openai", TEXT_MODEL)
        text = await chat.send_message(UserMessage(text=prompt))
        cleaned = re.sub(r"```(json)?", "", text).strip()
        m = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if m:
            arr = json.loads(m.group(0))
            items = [str(x) for x in arr if isinstance(x, (str,))][:6]
    except Exception as e:
        logger.warning(f"assistant products failed: {e}")
    if not items:
        items = ["Rattan corner sofa set", "Solar festoon lights", "Large ceramic planter", "Composite decking boards", "Outdoor rug", "Fire pit bowl"]
    return {"products": items}
