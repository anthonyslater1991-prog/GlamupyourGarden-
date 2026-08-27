from core import *  # noqa: F401,F403




# ---------------------------------------------------------------------------
# AI Garden Assistant chatbot
# ---------------------------------------------------------------------------
@api_router.post("/chat")
async def chat_assistant(body: ChatInput, user: dict = Depends(get_current_user)):
    history = await db.chat_messages.find({"session_id": body.session_id, "user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(30)
    await db.chat_messages.insert_one({"session_id": body.session_id, "user_id": user["user_id"], "role": "user", "text": body.message, "created_at": now_iso()})

    context = "\n".join([f"{m['role']}: {m['text']}" for m in history[-8:]])
    system = (
        "You are 'Bloom', the friendly AI Garden Assistant for the 'Glam up your Garden' app. 🌿 "
        "You help people with garden design, plants, landscaping, maintenance, and turning their outdoor space into something beautiful. "
        "Be warm, encouraging and concise. Use the occasional garden emoji (🌸🌿🐝☀️). "
        "If asked about anything unrelated to gardens or the app, gently steer back to gardening."
    )
    try:
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=body.session_id, system_message=system)
        chat.with_model("openai", TEXT_MODEL)
        prompt = (context + "\n" if context else "") + f"user: {body.message}"
        reply = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"chat failed: {e}")
        reply = "Sorry, I'm having trouble right now. 🌱 Please try again in a moment."

    await db.chat_messages.insert_one({"session_id": body.session_id, "user_id": user["user_id"], "role": "assistant", "text": reply, "created_at": now_iso()})
    return {"reply": reply}


@api_router.get("/chat/{session_id}")
async def chat_history(session_id: str, user: dict = Depends(get_current_user)):
    msgs = await db.chat_messages.find({"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"messages": msgs}
