from core import *  # noqa: F401,F403




@api_router.post("/contracts")
async def create_contract(body: ContractCreate, user: dict = Depends(get_current_user)):
    contractor = await db.contractors.find_one({"id": body.contractor_id}, {"_id": 0})
    if not contractor:
        raise HTTPException(status_code=404, detail="Contractor not found")

    project = None
    if body.project_id:
        project = await db.projects.find_one({"id": body.project_id, "owner_id": user["user_id"]}, {"_id": 0})

    services = ", ".join(contractor.get("services", [])) or "garden landscaping"
    proj_title = (project or {}).get("title")
    scope = body.scope or (
        f"Garden work for '{proj_title}': {services}." if proj_title else f"Garden work: {services}."
    )
    start = body.start_date or "To be agreed"
    end = body.end_date or "To be agreed"

    contract = {
        "id": new_id("contract"),
        "project_id": body.project_id,
        "project_title": proj_title,
        "contractor_id": contractor["id"],
        "contractor_name": contractor.get("name"),
        "contractor_phone": contractor.get("phone"),
        "customer_id": user["user_id"],
        "customer_name": user.get("name") or "Customer",
        "customer_phone": user.get("phone") or "",
        "status": "draft",
        # editable terms
        "scope": scope,
        "price": body.price or "To be agreed",
        "start_date": start,
        "end_date": end,
        "deposit_percent": max(0, min(100, body.deposit_percent)) if body.deposit_percent is not None else 30,
        "payment_terms": body.payment_terms or "Deposit on start, balance due on completion.",
        "materials": body.materials or "Materials included in the price unless stated otherwise.",
        "warranty": body.warranty or "12 months workmanship guarantee.",
        "site_address": body.site_address or user.get("address") or user.get("postcode") or "",
        "notes": body.notes or "",
        # deposit + review tracking
        "deposit_paid": False,
        "deposit_amount": None,
        "deposit_session_id": None,
        "reviewed": False,
        "review_dismissed": False,
        # quote
        "quote_status": "none",  # none | proposed | accepted | declined
        "quote_amount": None,
        "quote_items": [],
        "quote_note": "",
        "quote_proposed_at": None,
        "quote_decided_at": None,
        # milestones / escrow
        "milestones": [],
        "customer_confirmed": False,
        "confirmed_at": None,
        "release_ready": False,
        # signatures
        "customer_signed": False,
        "customer_signature": None,
        "customer_signed_at": None,
        "contractor_signed": False,
        "contractor_signature": None,
        "contractor_signed_at": None,
        # discussion + job tracker
        "messages": [],
        "stages": [{"label": s, "done": False, "note": "", "updated_at": None} for s in DEFAULT_STAGES],
        "progress_index": 0,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.contracts.insert_one(contract)
    return {"contract": public_contract(contract), "clauses": [{"label": l, "text": t} for l, t in STANDARD_CLAUSES]}


@api_router.get("/contracts")
async def list_contracts(user: dict = Depends(get_current_user)):
    if user.get("role") == "admin":
        q = {}
    elif user.get("role") == "contractor":
        q = {"contractor_id": {"$in": await owned_contractor_ids(user)}}
    else:
        q = {"customer_id": user["user_id"]}
    docs = await db.contracts.find(q, {"_id": 0, "messages": 0}).sort("updated_at", -1).to_list(200)
    return {"contracts": docs}


@api_router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    return {"contract": public_contract(c), "clauses": [{"label": l, "text": t} for l, t in STANDARD_CLAUSES]}


@api_router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, body: ContractUpdate, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if _fully_signed(c):
        raise HTTPException(status_code=400, detail="This agreement is signed by both parties and can no longer be edited.")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"contract": public_contract(c)}
    if "deposit_percent" in updates:
        updates["deposit_percent"] = max(0, min(100, int(updates["deposit_percent"])))
    # editing terms invalidates any prior signature so both re-confirm
    updates.update({
        "customer_signed": False, "customer_signature": None, "customer_signed_at": None,
        "contractor_signed": False, "contractor_signature": None, "contractor_signed_at": None,
        "status": "draft", "updated_at": now_iso(),
    })
    await db.contracts.update_one({"id": contract_id}, {"$set": updates})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.post("/contracts/{contract_id}/messages")
async def contract_message(contract_id: str, body: ContractMessage, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Message is empty")
    role = "customer" if c.get("customer_id") == user["user_id"] else "contractor"
    msg = {
        "id": new_id("cmsg"),
        "sender_id": user["user_id"],
        "sender_name": user.get("name") or ("Customer" if role == "customer" else "Contractor"),
        "sender_role": role,
        "text": body.text.strip(),
        "created_at": now_iso(),
    }
    await db.contracts.update_one({"id": contract_id}, {"$push": {"messages": msg}, "$set": {"updated_at": now_iso()}})
    return {"message": msg}


@api_router.post("/contracts/{contract_id}/sign")
async def sign_contract(contract_id: str, body: ContractSign, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if not body.agree or not body.full_name.strip():
        raise HTTPException(status_code=400, detail="Type your full name to sign")
    is_customer = c.get("customer_id") == user["user_id"]
    now = now_iso()
    if is_customer:
        updates = {"customer_signed": True, "customer_signature": body.full_name.strip(), "customer_signed_at": now}
    else:
        # contractor / admin signs the contractor side
        updates = {"contractor_signed": True, "contractor_signature": body.full_name.strip(), "contractor_signed_at": now}

    merged = {**c, **updates}
    if _fully_signed(merged):
        updates["status"] = "active"
        # first stage auto-complete on signature
        stages = c.get("stages") or []
        if stages and not stages[0].get("done"):
            stages[0]["done"] = True
            stages[0]["updated_at"] = now
            updates["stages"] = stages
            updates["progress_index"] = 1
    else:
        updates["status"] = "awaiting_signatures"
    updates["updated_at"] = now
    await db.contracts.update_one({"id": contract_id}, {"$set": updates})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.post("/contracts/{contract_id}/stage")
async def update_stage(contract_id: str, body: StageUpdate, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="Only the contractor can update job progress")
    c = await _contract_or_404(contract_id, user)
    if not _fully_signed(c):
        raise HTTPException(status_code=400, detail="Both parties must sign before the job can start")
    stages = c.get("stages") or []
    idx = body.stage_index
    if idx < 0 or idx >= len(stages):
        raise HTTPException(status_code=400, detail="Invalid stage")
    now = now_iso()
    # mark all stages up to idx as done, later ones not done (allows moving back/forward)
    for i, s in enumerate(stages):
        s["done"] = i <= idx
        if i == idx:
            s["updated_at"] = now
            if body.note is not None:
                s["note"] = body.note.strip()
    progress_index = idx + 1
    status = "completed" if progress_index >= len(stages) else "active"
    await db.contracts.update_one(
        {"id": contract_id},
        {"$set": {"stages": stages, "progress_index": progress_index, "status": status, "updated_at": now}},
    )
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.get("/contracts/{contract_id}/pdf")
async def contract_pdf(contract_id: str, token: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    tok = token
    if not tok and authorization and authorization.startswith("Bearer "):
        tok = authorization[7:]
    user = await _resolve_user_from_token(tok)
    c = await _contract_or_404(contract_id, user)

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors as rlcolors

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=20, textColor=rlcolors.HexColor("#2C352E"))
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, textColor=rlcolors.HexColor("#4A7C59"), spaceBefore=10)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=15, textColor=rlcolors.HexColor("#2C352E"))
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, textColor=rlcolors.HexColor("#7A857C"))

    story = []
    story.append(Paragraph("Glam up your Garden — Service Agreement", h1))
    story.append(Paragraph(f"Project: {c.get('project_title') or 'Garden project'}", body))
    story.append(Paragraph(f"Agreement reference: {c['id']}", small))
    story.append(Spacer(1, 8))

    def kv(label, value):
        return [Paragraph(f"<b>{label}</b>", body), Paragraph(str(value or "—"), body)]

    parties = [
        kv("Customer", f"{c.get('customer_name')}  {c.get('customer_phone') or ''}"),
        kv("Contractor", f"{c.get('contractor_name')}  {c.get('contractor_phone') or ''}"),
        kv("Site address", c.get("site_address")),
    ]
    t = Table(parties, colWidths=[45 * mm, 120 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(t)

    story.append(Paragraph("Agreed terms", h2))
    terms = [
        kv("Scope of work", c.get("scope")),
        kv("Total price", c.get("price")),
        kv("Timeline", f"{c.get('start_date')} to {c.get('end_date')}"),
        kv("Deposit", f"{c.get('deposit_percent')}% up front"),
        kv("Payment terms", c.get("payment_terms")),
        kv("Materials", c.get("materials")),
        kv("Guarantee", c.get("warranty")),
    ]
    if c.get("notes"):
        terms.append(kv("Extra notes", c.get("notes")))
    tt = Table(terms, colWidths=[45 * mm, 120 * mm])
    tt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                            ("LINEBELOW", (0, 0), (-1, -1), 0.3, rlcolors.HexColor("#E6EBE4"))]))
    story.append(tt)

    if c.get("quote_items"):
        story.append(Paragraph("Quote breakdown", h2))
        rows = [[Paragraph(f"<b>{it.get('label')}</b>", body), Paragraph(_fmt_price(it.get('amount', 0)), body)] for it in c.get("quote_items", [])]
        rows.append([Paragraph("<b>Total</b>", body), Paragraph(_fmt_price(c.get("quote_amount") or 0), body)])
        qt = Table(rows, colWidths=[120 * mm, 45 * mm])
        qt.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                                ("LINEBELOW", (0, 0), (-1, -2), 0.3, rlcolors.HexColor("#E6EBE4")),
                                ("LINEABOVE", (0, -1), (-1, -1), 0.6, rlcolors.HexColor("#4A7C59"))]))
        story.append(qt)
    for label, text in STANDARD_CLAUSES:
        story.append(Paragraph(f"<b>{label}.</b> {text}", body))
        story.append(Spacer(1, 3))

    story.append(Paragraph("Signatures", h2))
    cust = f"{c.get('customer_signature')} — signed {(c.get('customer_signed_at') or '')[:10]}" if c.get("customer_signed") else "Not signed"
    pro = f"{c.get('contractor_signature')} — signed {(c.get('contractor_signed_at') or '')[:10]}" if c.get("contractor_signed") else "Not signed"
    sig = Table([kv("Customer signature", cust), kv("Contractor signature", pro)], colWidths=[45 * mm, 120 * mm])
    sig.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(sig)
    if c.get("deposit_paid"):
        story.append(Spacer(1, 6))
        story.append(Paragraph(f"Deposit of £{c.get('deposit_amount'):.2f} paid.", body))
    story.append(Spacer(1, 14))
    story.append(Paragraph("This document is a record generated by the Glam up your Garden app. It does not affect either party's statutory rights.", small))

    doc.build(story)
    buf.seek(0)
    filename = f"agreement-{c['id']}.pdf"
    return Response(content=buf.read(), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={filename}"})


@api_router.post("/contracts/{contract_id}/quote")
async def submit_quote(contract_id: str, body: QuoteSubmit, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    is_pro = user.get("role") == "admin" or (user.get("role") == "contractor" and c.get("contractor_id") in await owned_contractor_ids(user))
    if not is_pro:
        raise HTTPException(status_code=403, detail="Only the contractor can submit a quote")
    if c.get("deposit_paid"):
        raise HTTPException(status_code=400, detail="Deposit already paid — quote is locked")
    items = [{"label": i.label.strip(), "amount": round(float(i.amount), 2)} for i in body.items if i.label.strip()]
    total = body.amount if body.amount is not None else sum(i["amount"] for i in items)
    if total is None or total <= 0:
        raise HTTPException(status_code=400, detail="Enter a quote total or line items")
    total = round(float(total), 2)
    now = now_iso()
    await db.contracts.update_one({"id": contract_id}, {"$set": {
        "quote_status": "proposed",
        "quote_amount": total,
        "quote_items": items,
        "quote_note": (body.note or "").strip(),
        "quote_proposed_at": now,
        "quote_decided_at": None,
        "price": _fmt_price(total),
        "updated_at": now,
    }})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.post("/contracts/{contract_id}/quote/respond")
async def respond_quote(contract_id: str, body: QuoteRespond, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    if c.get("customer_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the customer can respond to the quote")
    if c.get("quote_status") != "proposed":
        raise HTTPException(status_code=400, detail="There is no quote awaiting your response")
    now = now_iso()
    updates = {
        "quote_status": "accepted" if body.accept else "declined",
        "quote_decided_at": now,
        "updated_at": now,
    }
    if body.accept:
        total = _parse_amount(c.get("price") or "") or (c.get("quote_amount") or 0)
        if total and total > 0:
            updates["milestones"] = _build_milestones(float(total), c.get("deposit_percent") or 0)
    await db.contracts.update_one({"id": contract_id}, {"$set": updates})
    fresh = await db.contracts.find_one({"id": contract_id})
    return {"contract": public_contract(fresh)}


@api_router.post("/contracts/{contract_id}/milestones/{key}/pay")
async def pay_milestone(contract_id: str, key: str, body: DepositRequest, user: dict = Depends(get_current_user)):
    c = await _contract_or_404(contract_id, user)
    return await _pay_milestone(c, key, body.origin, user)


@api_router.post("/contracts/{contract_id}/deposit")
async def start_deposit(contract_id: str, body: DepositRequest, user: dict = Depends(get_current_user)):
    # Backwards-compatible alias for the deposit milestone.
    c = await _contract_or_404(contract_id, user)
    return await _pay_milestone(c, "deposit", body.origin, user)


@api_router.get("/payments/status/{session_id}")
async def payment_status(session_id: str, user: dict = Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Payment not found")
    if _real_stripe():
        session = await run_in_threadpool(lambda: _stripe_sdk.checkout.Session.retrieve(session_id))
        pay_status = session.get("payment_status")
        stat = session.get("status")
        amount_total = session.get("amount_total")
        currency = session.get("currency")
        charge_id = None
        if pay_status == "paid" and session.get("payment_intent"):
            pi = await run_in_threadpool(lambda: _stripe_sdk.PaymentIntent.retrieve(session["payment_intent"]))
            charge_id = pi.get("latest_charge")
    else:
        stripe = StripeCheckout(api_key=STRIPE_API_KEY)
        status = await stripe.get_checkout_status(session_id)
        pay_status, stat, amount_total, currency, charge_id = status.payment_status, status.status, status.amount_total, status.currency, None

    updates = {"payment_status": pay_status, "status": stat}
    if pay_status == "paid" and tx.get("payment_status") != "paid":
        updates["paid_at"] = now_iso()
        if charge_id:
            updates["charge_id"] = charge_id
        key = tx.get("milestone_key", "deposit")
        mset = {"milestones.$.status": "paid", "milestones.$.paid_at": now_iso()}
        if charge_id:
            mset["milestones.$.charge_id"] = charge_id
        await db.contracts.update_one({"id": tx["contract_id"], "milestones.key": key}, {"$set": mset})
        if key == "deposit":
            cset = {"deposit_paid": True}
            if charge_id:
                cset["deposit_charge_id"] = charge_id
            await db.contracts.update_one({"id": tx["contract_id"]}, {"$set": cset})
    await db.payment_transactions.update_one({"session_id": session_id}, {"$set": updates})
    return {"payment_status": pay_status, "status": stat, "amount_total": amount_total, "currency": currency}
