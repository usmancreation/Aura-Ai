import os
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, render_template, send_from_directory, request, jsonify, session, redirect, url_for
from database import register_user, authenticate_user, get_user_by_id, init_db

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
app = Flask(__name__, template_folder="templates")
app.secret_key = "aura_ai_secure_session_key_2026_vector_engine_auth"
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Initialize database
init_db()

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/dashboard")
@app.get("/dashboard.html")
def dashboard():
    return render_template("dashboard.html")

@app.get("/signin")
@app.get("/login")
@app.get("/signin.html")
@app.get("/login.html")
def signin():
    return render_template("signin.html")

@app.get("/signup")
@app.get("/register")
@app.get("/signup.html")
@app.get("/register.html")
def signup():
    return render_template("signup.html")

@app.get("/about")
@app.get("/about.html")
def about():
    return render_template("about.html")

@app.get("/contact")
@app.get("/contact.html")
def contact():
    return render_template("contact.html")

# --- Auth APIs ---
@app.post("/api/auth/register")
def api_register():
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip()
    password = data.get("password", "").strip()

    try:
        from firebase_service import register_user as fb_register
        fb_res = fb_register(name, email, password)
        user_data = {
            "id": fb_res.get("uid"),
            "uid": fb_res.get("uid"),
            "name": fb_res.get("name"),
            "email": fb_res.get("email"),
            "role": "Tech Professional",
            "id_token": fb_res.get("id_token", ""),
        }
        session["user"] = user_data
        return jsonify({"success": True, "user": user_data, "message": "Account created in Firebase."})
    except Exception as fb_err:
        success, user_data, error_msg = register_user(name, email, password)
        if success:
            session["user"] = user_data
            return jsonify({"success": True, "user": user_data, "message": "Account created successfully."})
        return jsonify({"success": False, "error": str(fb_err) or error_msg}), 400

@app.post("/api/auth/login")
def api_login():
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    email = data.get("email", "").strip()
    password = data.get("password", "").strip()

    try:
        from firebase_service import login_user as fb_login
        fb_res = fb_login(email, password)
        user_data = {
            "id": fb_res.get("uid"),
            "uid": fb_res.get("uid"),
            "name": fb_res.get("name"),
            "email": fb_res.get("email"),
            "role": "Tech Professional",
            "id_token": fb_res.get("id_token", ""),
        }
        session["user"] = user_data
        return jsonify({"success": True, "user": user_data, "message": "Logged in via Firebase."})
    except Exception as fb_err:
        success, user_data, error_msg = authenticate_user(email, password)
        if success:
            session["user"] = user_data
            return jsonify({"success": True, "user": user_data, "message": "Logged in successfully."})
        return jsonify({"success": False, "error": str(fb_err) or error_msg}), 401

@app.route("/api/auth/logout", methods=["GET", "POST"])
def api_logout():
    session.pop("user", None)
    if request.headers.get("Accept") == "application/json" or request.is_json or request.method == "POST":
        return jsonify({"success": True, "message": "Logged out successfully."})
    return redirect("/")

@app.get("/api/auth/me")
def api_me():
    user = session.get("user")
    if user:
        return jsonify({"authenticated": True, "user": user})
    return jsonify({"authenticated": False, "user": None})

# Global in-memory conversation state per user
USER_CONVERSATIONS = {}

@app.post("/api/chat")
def api_chat():
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    user_msg = data.get("message", "").strip()
    human_approved = bool(data.get("human_approved", False))

    if not user_msg:
        return jsonify({"success": False, "reply": "Please enter a message."}), 400

    # 1. OWASP LLM Input Validation & Prompt Injection Protection
    from security import validate_user_input, looks_like_prompt_injection, sanitize_output
    try:
        user_msg = validate_user_input(user_msg)
    except ValueError as e:
        return jsonify({"success": False, "reply": str(e)}), 400

    if looks_like_prompt_injection(user_msg):
        warning = (
            "✦ **Aura Security Shield:** Your query triggered an OWASP LLM prompt injection guardrail. "
            "Please rephrase your career request without attempting to extract internal instructions or override rules."
        )
        return jsonify({"success": True, "reply": warning})

    # 2. Check GROQ_API_KEY from .env
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if not groq_key or groq_key == "YOUR_GROQ_API_KEY_HERE":
        reply_notice = (
            "✦ **Aura AI Agent is Ready!**\n\n"
            "Your Agent is configured with **CrewAI**, **FAISS RAG Knowledge Base**, and **4 External Tools** (Wikipedia, Web Search, API Tool, Calculator).\n\n"
            "👉 **To connect real-time Groq LLM intelligence:**\n"
            "Open the `.env` file in your project root and paste your Groq API key:\n\n"
            "```env\nGROQ_API_KEY=\"gsk_your_key_here\"\n```\n\n"
            "Once pasted, Aura will immediately respond with live agentic reasoning, RAG context, and tool observations!"
        )
        return jsonify({"success": True, "reply": reply_notice, "needs_key": True})

    # 3. Retrieve Context from FAISS RAG
    try:
        from rag import retrieve_context
        retrieved = retrieve_context(user_msg, k=4)
    except Exception:
        retrieved = ""

    # 4. Short-term Conversation Memory
    from memory import ConversationMemory
    user_id = session.get("user", {}).get("email", "default_guest")
    if user_id not in USER_CONVERSATIONS:
        USER_CONVERSATIONS[user_id] = ConversationMemory(max_turns=6)
    mem = USER_CONVERSATIONS[user_id]

    # 5. Execute CrewAI Agent with 1-Retry Policy
    try:
        from agent import run_aura
        agent_reply = run_aura(
            user_query=user_msg,
            memory=mem,
            retrieved_context=retrieved,
            human_approved=human_approved,
        )
        mem.add_turn(user_msg, agent_reply)
        clean_reply = sanitize_output(agent_reply)
        return jsonify({"success": True, "reply": clean_reply})
    except Exception as err:
        return jsonify({
            "success": True,
            "reply": f"**Aura Agent Note:** Groq API call encountered: {str(err)}. Please verify your `GROQ_API_KEY` in `.env`."
        }), 200

# Assets and static files
@app.get("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(BASE_DIR / "assets", filename)

@app.get("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(BASE_DIR / "static", filename)

@app.get("/<path:filename>")
def root_files(filename):
    target = BASE_DIR / filename
    if target.is_file():
        return send_from_directory(BASE_DIR, filename)
    return render_template("index.html"), 404

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
