from core import *  # noqa: F401,F403

import io
from PIL import Image as PILImage, ImageDraw, ImageFont


class FavouriteInput(BaseModel):
    favourite: bool


class ShareInput(BaseModel):
    design_id: str


def _share_font(size: int, bold: bool = True):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def compose_before_after(orig_bytes: bytes, after_bytes: bytes) -> bytes:
    H = 900
    gap = 18
    banner = 96
    footer = 84

    def prep(b: bytes) -> "PILImage.Image":
        im = PILImage.open(io.BytesIO(b)).convert("RGB")
        w = max(1, int(im.width * (H / im.height)))
        return im.resize((w, H))

    a = prep(orig_bytes)
    b = prep(after_bytes)
    W = a.width + b.width + gap
    canvas = PILImage.new("RGB", (W, H + banner + footer), (27, 36, 30))
    canvas.paste(a, (0, banner))
    canvas.paste(b, (a.width + gap, banner))
    draw = ImageDraw.Draw(canvas)

    f_title = _share_font(52)
    f_label = _share_font(34)
    f_foot = _share_font(34)

    draw.text((28, 24), "My Garden Makeover \u2728", fill=(255, 255, 255), font=f_title)

    def pill(x: int, text: str, color):
        bbox = draw.textbbox((0, 0), text, font=f_label)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad = 12
        draw.rectangle([x + 18, banner + 18, x + 18 + tw + pad * 2, banner + 18 + th + pad * 2 + 6], fill=color)
        draw.text((x + 18 + pad, banner + 18 + pad), text, fill=(255, 255, 255), font=f_label)

    pill(0, "BEFORE", (70, 70, 70))
    pill(a.width + gap, "AFTER", (74, 124, 89))

    foot = "Glam up your Garden"
    fb = draw.textbbox((0, 0), foot, font=f_foot)
    draw.text(((W - (fb[2] - fb[0])) / 2, H + banner + 22), foot, fill=(198, 214, 190), font=f_foot)

    out = io.BytesIO()
    canvas.save(out, format="PNG")
    return out.getvalue()






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


@api_router.post("/projects/{project_id}/designs/{design_id}/favourite")
async def favourite_design(project_id: str, design_id: str, body: FavouriteInput, user: dict = Depends(get_current_user)):
    res = await db.projects.update_one(
        {"id": project_id, "owner_id": user["user_id"], "designs.id": design_id},
        {"$set": {"designs.$.favourite": body.favourite}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "favourite": body.favourite}


@api_router.post("/projects/{project_id}/share-image")
async def share_image(project_id: str, body: ShareInput, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "owner_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.get("original_path"):
        raise HTTPException(status_code=400, detail="Project has no garden photo")
    design = next((d for d in project.get("designs", []) if d.get("id") == body.design_id), None)
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")

    orig_bytes, _ = await run_in_threadpool(get_object, project["original_path"])
    after_bytes, _ = await run_in_threadpool(get_object, design["image_path"])
    out_bytes = await run_in_threadpool(compose_before_after, orig_bytes, after_bytes)
    out_path = f"{APP_NAME}/shares/{user['user_id']}/{uuid.uuid4().hex}.png"
    await run_in_threadpool(put_object, out_path, out_bytes, "image/png")
    await db.uploads.insert_one({"path": out_path, "owner_id": user["user_id"], "content_type": "image/png", "created_at": now_iso(), "share": True})
    return {"image_path": out_path}


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
