from core import *  # noqa: F401,F403




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
        "author_id": user["user_id"],
        "author_name": user.get("name") or "Customer",
        "rating": max(1, min(5, body.rating)),
        "text": body.text,
        "image_paths": (body.image_paths or [])[:6],
        "created_at": now_iso(),
    }
    await db.reviews.insert_one(review)
    reviews = await db.reviews.find({"contractor_id": contractor_id}).to_list(1000)
    avg = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
    await db.contractors.update_one({"id": contractor_id}, {"$set": {"rating": avg, "review_count": len(reviews)}})
    review.pop("_id", None)
    # If this review came from a completed-job reminder, mark that contract reviewed
    if body.contract_id:
        await db.contracts.update_one(
            {"id": body.contract_id, "customer_id": user["user_id"]},
            {"$set": {"reviewed": True}},
        )
    else:
        await db.contracts.update_many(
            {"contractor_id": contractor_id, "customer_id": user["user_id"], "status": "completed"},
            {"$set": {"reviewed": True}},
        )
    return {"review": review, "rating": avg, "review_count": len(reviews)}


@api_router.put("/contractors/{contractor_id}/coverage")
async def set_coverage(contractor_id: str, body: CoverageInput, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "contractor"):
        raise HTTPException(status_code=403, detail="Only contractors or admins can set coverage")
    miles = max(1, min(500, body.miles))
    res = await db.contractors.update_one({"id": contractor_id}, {"$set": {"coverage_miles": miles}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    return {"contractor": doc}


@api_router.post("/contractors/{contractor_id}/claim")
async def claim_contractor(contractor_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "contractor":
        raise HTTPException(status_code=403, detail="Only contractor accounts can claim a listing")
    c = await db.contractors.find_one({"id": contractor_id})
    if not c:
        raise HTTPException(status_code=404, detail="Listing not found")
    if c.get("claim_status") == "approved":
        if c.get("claimed_by") == user["user_id"]:
            return {"ok": True, "claim_status": "approved"}
        raise HTTPException(status_code=400, detail="This listing is already claimed by another contractor")
    # only one active claim per contractor at a time
    await db.contractors.update_one({"id": contractor_id}, {"$set": {
        "claim_status": "pending",
        "claim_user_id": user["user_id"],
        "claim_user_name": user.get("name"),
        "claim_requested_at": now_iso(),
    }})
    return {"ok": True, "claim_status": "pending"}


@api_router.get("/my-contractor")
async def my_contractor(user: dict = Depends(get_current_user)):
    if user.get("role") != "contractor":
        return {"contractor": None, "pending": None}
    approved = await db.contractors.find_one({"claimed_by": user["user_id"], "claim_status": "approved"}, {"_id": 0})
    pending = await db.contractors.find_one({"claim_user_id": user["user_id"], "claim_status": "pending"}, {"_id": 0})
    return {"contractor": approved, "pending": pending}


@api_router.put("/contractors/{contractor_id}/profile")
async def update_contractor_profile(contractor_id: str, body: ContractorProfileUpdate, user: dict = Depends(get_current_user)):
    if not await can_manage_contractor(user, contractor_id):
        raise HTTPException(status_code=403, detail="You don't manage this listing")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "coverage_miles" in updates:
        updates["coverage_miles"] = max(1, min(500, int(updates["coverage_miles"])))
    if updates:
        await db.contractors.update_one({"id": contractor_id}, {"$set": updates})
    doc = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    return {"contractor": doc}


@api_router.post("/contractors/{contractor_id}/reviews/{review_id}/reply")
async def reply_to_review(contractor_id: str, review_id: str, body: ReviewReply, user: dict = Depends(get_current_user)):
    if not await can_manage_contractor(user, contractor_id):
        raise HTTPException(status_code=403, detail="You don't manage this listing")
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Reply is empty")
    res = await db.reviews.update_one(
        {"id": review_id, "contractor_id": contractor_id},
        {"$set": {"reply": body.text.strip(), "reply_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")
    review = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return {"review": review}


@api_router.get("/admin/claims")
async def list_claims(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    docs = await db.contractors.find({"claim_status": "pending"}, {"_id": 0}).to_list(100)
    return {"claims": docs}


@api_router.post("/admin/claims/{contractor_id}/action")
async def act_on_claim(contractor_id: str, body: ClaimAction, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    c = await db.contractors.find_one({"id": contractor_id})
    if not c or c.get("claim_status") != "pending":
        raise HTTPException(status_code=404, detail="No pending claim for this listing")
    if body.action == "approve":
        await db.contractors.update_one({"id": contractor_id}, {"$set": {
            "claim_status": "approved",
            "claimed_by": c.get("claim_user_id"),
            "claim_approved_at": now_iso(),
        }})
    elif body.action == "reject":
        await db.contractors.update_one({"id": contractor_id}, {"$set": {"claim_status": "unclaimed"}, "$unset": {"claim_user_id": "", "claim_user_name": ""}})
    else:
        raise HTTPException(status_code=400, detail="action must be approve or reject")
    doc = await db.contractors.find_one({"id": contractor_id}, {"_id": 0})
    return {"contractor": doc}
