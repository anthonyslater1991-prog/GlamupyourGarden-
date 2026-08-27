from core import *  # noqa: F401,F403




@api_router.post("/contracts/{contract_id}/confirm-complete")
async def confirm_complete(contract_id: str, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if c.get("customer_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the customer can confirm the job")
    if c.get("status") != "completed":
        raise HTTPException(status_code=400, detail="The contractor needs to mark the job complete first")
    now = now_iso()
    await db.contracts.update_one({"id": contract_id}, {"$set": {"customer_confirmed": True, "confirmed_at": now, "updated_at": now}})
    c["customer_confirmed"] = True
    result = await _try_release(c)
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh), **result}


@api_router.post("/connect/onboard")
async def connect_onboard(body: ConnectOnboard, user: dict = Depends(get_current_user)):
    _connect_guard()
    ids = await owned_contractor_ids(user)
    if not ids:
        raise HTTPException(status_code=403, detail="Claim and get approval for a listing first")
    cid = ids[0]
    contractor = await db.contractors.find_one({"id": cid})
    account_id = contractor.get("stripe_account_id")
    if not account_id:
        account = await run_in_threadpool(lambda: _stripe_sdk.Account.create(
            type="express",
            email=user.get("email"),
            capabilities={"transfers": {"requested": True}},
            metadata={"contractor_id": cid},
        ))
        account_id = account["id"]
        await db.contractors.update_one({"id": cid}, {"$set": {"stripe_account_id": account_id, "onboarding_status": "created"}})
    origin = body.origin.rstrip("/")
    link = await run_in_threadpool(lambda: _stripe_sdk.AccountLink.create(
        account=account_id,
        refresh_url=f"{origin}/contractor-hub?connect=refresh",
        return_url=f"{origin}/contractor-hub?connect=return",
        type="account_onboarding",
    ))
    return {"url": link["url"], "account_id": account_id}


@api_router.get("/connect/status")
async def connect_status(user: dict = Depends(get_current_user)):
    ids = await owned_contractor_ids(user)
    if not ids:
        return {"connected": False, "payouts_enabled": False, "onboarded": False}
    contractor = await db.contractors.find_one({"id": ids[0]})
    account_id = contractor.get("stripe_account_id")
    if not account_id or not _real_stripe():
        return {"connected": False, "payouts_enabled": bool(contractor.get("payouts_enabled")), "onboarded": False}
    account = await run_in_threadpool(lambda: _stripe_sdk.Account.retrieve(account_id))
    payouts = bool(account.get("payouts_enabled"))
    details = bool(account.get("details_submitted"))
    await db.contractors.update_one({"id": ids[0]}, {"$set": {
        "payouts_enabled": payouts,
        "charges_enabled": bool(account.get("charges_enabled")),
        "onboarding_status": "complete" if details else "incomplete",
    }})
    # Auto-release any contracts that were waiting for this contractor's payouts to be ready
    if payouts:
        waiting = await db.contracts.find({"contractor_id": ids[0], "release_ready": True}).to_list(100)
        for w in waiting:
            await _try_release(w)
    return {"connected": True, "payouts_enabled": payouts, "onboarded": details,
            "currently_due": (account.get("requirements") or {}).get("currently_due", [])}


@api_router.get("/contractor/earnings")
async def contractor_earnings(user: dict = Depends(get_current_user)):
    ids = await owned_contractor_ids(user)
    if not ids:
        return {"held": 0.0, "released": 0.0, "items": []}
    docs = await db.contracts.find({"contractor_id": {"$in": ids}}, {"_id": 0, "messages": 0}).sort("updated_at", -1).to_list(500)
    fee = await _platform_fee_percent()
    held = 0.0
    released = 0.0
    items = []
    for d in docs:
        c_held = 0.0
        c_rel = 0.0
        for m in d.get("milestones") or []:
            if m.get("status") == "paid":
                c_held += round(m["amount"] * (1 - fee / 100.0), 2)
            elif m.get("status") == "released":
                c_rel += float(m.get("release_amount") or 0)
        held += c_held
        released += c_rel
        if c_held > 0 or c_rel > 0:
            items.append({
                "contract_id": d["id"], "project_title": d.get("project_title"),
                "customer_name": d.get("customer_name"), "status": d.get("status"),
                "held": round(c_held, 2), "released": round(c_rel, 2),
            })
    return {"held": round(held, 2), "released": round(released, 2), "items": items}


@api_router.get("/admin/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return {"platform_fee_percent": await _platform_fee_percent(), "connect_enabled": _real_stripe()}


@api_router.post("/admin/settings")
async def set_settings(body: SettingsInput, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    pct = max(0.0, min(50.0, float(body.platform_fee_percent)))
    await db.settings.update_one({"id": "global"}, {"$set": {"platform_fee_percent": pct}}, upsert=True)
    return {"platform_fee_percent": pct}


@api_router.get("/admin/releases")
async def list_releases(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    docs = await db.contracts.find(
        {"milestones": {"$elemMatch": {"status": "paid"}}},
        {"_id": 0, "messages": 0},
    ).sort("updated_at", -1).to_list(100)
    fee_pct = await _platform_fee_percent()
    out = []
    for d in docs:
        contractor = await db.contractors.find_one({"id": d.get("contractor_id")}, {"_id": 0})
        held = sum(m["amount"] for m in (d.get("milestones") or []) if m.get("status") == "paid")
        fee = round(held * fee_pct / 100.0, 2)
        out.append({
            "contract_id": d["id"],
            "project_title": d.get("project_title"),
            "customer_name": d.get("customer_name"),
            "contractor_name": d.get("contractor_name"),
            "deposit_amount": round(held, 2),
            "platform_fee": fee,
            "net_to_contractor": round(held - fee, 2),
            "job_status": d.get("status"),
            "customer_confirmed": bool(d.get("customer_confirmed")),
            "payouts_enabled": bool(contractor and contractor.get("payouts_enabled")),
            "has_stripe_account": bool(contractor and contractor.get("stripe_account_id")),
        })
    return {"releases": out, "fee_percent": fee_pct, "connect_enabled": _real_stripe()}


@api_router.post("/admin/contracts/{contract_id}/release")
async def release_deposit(contract_id: str, body: ReleaseInput, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    c = await db.contracts.find_one({"id": contract_id})
    if not c:
        raise HTTPException(status_code=404, detail="Contract not found")
    _connect_guard()
    paid = [m for m in (c.get("milestones") or []) if m.get("status") == "paid"]
    if not paid:
        raise HTTPException(status_code=400, detail="No held funds to release")
    contractor = await db.contractors.find_one({"id": c.get("contractor_id")})
    if not (contractor and contractor.get("stripe_account_id")):
        raise HTTPException(status_code=400, detail="Contractor hasn't connected a payout account yet")
    if not contractor.get("payouts_enabled"):
        raise HTTPException(status_code=400, detail="Contractor's payouts aren't enabled yet (onboarding incomplete)")
    res = await _try_release(c, body.fee_percent)
    return {"ok": True, **res}


@api_router.get("/reminders")
async def review_reminders(user: dict = Depends(get_current_user)):
    docs = await db.contracts.find(
        {"customer_id": user["user_id"], "status": "completed", "reviewed": {"$ne": True}, "review_dismissed": {"$ne": True}},
        {"_id": 0, "messages": 0},
    ).sort("updated_at", -1).to_list(50)
    prompts = [{
        "contract_id": d["id"],
        "contractor_id": d.get("contractor_id"),
        "contractor_name": d.get("contractor_name"),
        "project_title": d.get("project_title"),
    } for d in docs]
    return {"review_prompts": prompts, "count": len(prompts)}


@api_router.post("/contracts/{contract_id}/dismiss-review")
async def dismiss_review_prompt(contract_id: str, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if c.get("customer_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your contract")
    await db.contracts.update_one({"id": contract_id}, {"$set": {"review_dismissed": True}})
    return {"ok": True}
