from core import *  # noqa: F401,F403




@api_router.get("/map/contractors")
async def map_contractors(user: dict = Depends(get_current_user)):
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    my_coord = None
    if me and me.get("lat") is not None:
        my_coord = {"lat": me["lat"], "lng": me["lng"]}
    elif me and me.get("postcode"):
        my_coord = await geocode_postcode(me["postcode"])
        if my_coord:
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"lat": my_coord["lat"], "lng": my_coord["lng"]}})

    cons = await db.contractors.find({}, {"_id": 0}).to_list(200)
    pins = []
    out = []
    for c in cons:
        coord = None
        if c.get("lat") is not None:
            coord = {"lat": c["lat"], "lng": c["lng"]}
        elif c.get("postcode"):
            coord = await geocode_postcode(c["postcode"])
            if coord:
                await db.contractors.update_one({"id": c["id"]}, {"$set": {"lat": coord["lat"], "lng": coord["lng"]}})
        item = {**c, "lat": coord["lat"] if coord else None, "lng": coord["lng"] if coord else None, "distance_km": None}
        coverage_miles = c.get("coverage_miles", 25)
        item["coverage_miles"] = coverage_miles
        item["reachable"] = False
        if coord and my_coord:
            item["distance_km"] = haversine_km(my_coord, coord)
            item["reachable"] = item["distance_km"] <= coverage_miles * 1.60934
        if coord:
            pins.append({"lat": coord["lat"], "lng": coord["lng"], "style": "green-pushpin"})
        out.append(item)

    out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] if x["distance_km"] is not None else 0))
    if my_coord:
        pins.append({"lat": my_coord["lat"], "lng": my_coord["lng"], "style": "red-pushpin"})
    return {"me": my_coord, "contractors": out, "map_url": static_map_url(pins, my_coord)}


@api_router.get("/alerts/nearby")
async def nearby_alerts(user: dict = Depends(get_current_user)):
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    my_coord = None
    if me and me.get("lat") is not None:
        my_coord = {"lat": me["lat"], "lng": me["lng"]}
    elif me and me.get("postcode"):
        my_coord = await geocode_postcode(me["postcode"])
        if my_coord:
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"lat": my_coord["lat"], "lng": my_coord["lng"]}})
    if not my_coord:
        return {"alerts": []}

    cons = await db.contractors.find({}, {"_id": 0}).to_list(200)
    alerts = []
    for c in cons:
        coord = None
        if c.get("lat") is not None:
            coord = {"lat": c["lat"], "lng": c["lng"]}
        elif c.get("postcode"):
            coord = await geocode_postcode(c["postcode"])
        if not coord:
            continue
        dist = haversine_km(my_coord, coord)
        coverage_km = c.get("coverage_miles", 25) * 1.60934
        if c.get("rating", 0) >= 4.7 and dist <= coverage_km:
            alerts.append({
                "id": c["id"], "name": c["name"], "tagline": c.get("tagline", ""),
                "rating": c.get("rating"), "image": c.get("image"),
                "distance_km": dist, "coverage_miles": c.get("coverage_miles", 25),
            })
    alerts.sort(key=lambda x: x["distance_km"])
    return {"alerts": alerts}


@api_router.get("/admin/map")
async def admin_map(admin: dict = Depends(get_admin_user)):
    owner_ids = await db.projects.distinct("owner_id")
    customers = []
    pins = []
    for oid in owner_ids:
        u = await db.users.find_one({"user_id": oid}, {"_id": 0})
        if not u:
            continue
        coord = None
        if u.get("lat") is not None:
            coord = {"lat": u["lat"], "lng": u["lng"]}
        elif u.get("postcode"):
            coord = await geocode_postcode(u["postcode"])
            if coord:
                await db.users.update_one({"user_id": oid}, {"$set": {"lat": coord["lat"], "lng": coord["lng"]}})
        pc = await db.projects.count_documents({"owner_id": oid})
        customers.append({"name": u.get("name"), "postcode": u.get("postcode"), "phone": u.get("phone"),
                          "lat": coord["lat"] if coord else None, "lng": coord["lng"] if coord else None, "project_count": pc})
        if coord:
            pins.append({"lat": coord["lat"], "lng": coord["lng"], "style": "red-pushpin"})

    cons = await db.contractors.find({}, {"_id": 0}).to_list(200)
    contractors = []
    for c in cons:
        coord = None
        if c.get("lat") is not None:
            coord = {"lat": c["lat"], "lng": c["lng"]}
        elif c.get("postcode"):
            coord = await geocode_postcode(c["postcode"])
        contractors.append({"name": c.get("name"), "postcode": c.get("postcode"),
                            "lat": coord["lat"] if coord else None, "lng": coord["lng"] if coord else None})
        if coord:
            pins.append({"lat": coord["lat"], "lng": coord["lng"], "style": "green-pushpin"})

    return {"customers": customers, "contractors": contractors, "map_url": static_map_url(pins, None)}
