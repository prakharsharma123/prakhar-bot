import os
import sqlite3
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, render_template, request, jsonify, session, send_file, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from google import genai
from google.genai import types

from resume_data import PROFILE

# --------------------------------------------------------------------------
# Config (all secrets come from environment variables — never hardcode keys)
# --------------------------------------------------------------------------
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
FLASK_SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "d775e610d88de979e31e3b0ceefc8a499e43838053c9381c3b5862ad4513603f")
ADMIN_EXPORT_KEY = os.environ.get("ADMIN_EXPORT_KEY", "prakharsharmachatbox")
FREE_MESSAGE_LIMIT = int(os.environ.get("FREE_MESSAGE_LIMIT", "6"))
DB_PATH = os.environ.get("DB_PATH", "chatbot.db")

# Single admin account (that's you, Prakhar). Change these via environment
# variables before deploying — never leave the default password in production.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "prakhar")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "prakharsharmawork1@gmail.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Prakhar@123")
ADMIN_DISPLAY_NAME = os.environ.get("ADMIN_DISPLAY_NAME", "Prakhar Sharma")
ADMIN_PASSWORD_HASH = generate_password_hash(ADMIN_PASSWORD)

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            event_type TEXT NOT NULL,   -- 'signup' or 'login'
            event_time TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
        """
    )
    # Every chat turn (guest or signed-in) is logged here so the admin
    # dashboard can show who has been talking to the bot and read back
    # the conversation.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_type TEXT NOT NULL,   -- 'user' or 'guest'
            person_key TEXT NOT NULL,    -- user id (as text) or guest id
            person_name TEXT,
            person_email TEXT,
            message TEXT NOT NULL,
            reply TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log_message(person_type, person_key, person_name, person_email, message, reply):
    conn = get_db()
    conn.execute(
        """
        INSERT INTO messages (person_type, person_key, person_name, person_email, message, reply, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (person_type, person_key, person_name, person_email, message, reply, now_iso()),
    )
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Auth guard for the admin area
# --------------------------------------------------------------------------
def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("is_admin"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Admin login required."}), 401
            return redirect(url_for("admin_login"))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------
# Routes — pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/admin/login", methods=["GET"])
def admin_login():
    if session.get("is_admin"):
        return redirect(url_for("admin_dashboard"))
    return render_template("admin_login.html")


@app.route("/admin/dashboard")
@admin_required
def admin_dashboard():
    return render_template("admin_dashboard.html", admin_name=session.get("admin_name"))


# --------------------------------------------------------------------------
# Routes — session state (frontend calls this on load to sync UI)
# --------------------------------------------------------------------------
@app.route("/api/session")
def api_session():
    return jsonify(
        {
            "logged_in": bool(session.get("logged_in")),
            "name": session.get("name"),
            "chat_count": session.get("chat_count", 0),
            "limit": FREE_MESSAGE_LIMIT,
        }
    )


# --------------------------------------------------------------------------
# Routes — chat
# --------------------------------------------------------------------------
@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message is empty."}), 400

    logged_in = bool(session.get("logged_in"))
    chat_count = session.get("chat_count", 0)

    # Gate: once a guest hits the free limit, stop calling the AI and ask
    # them to sign up / log in instead.
    if not logged_in and chat_count >= FREE_MESSAGE_LIMIT:
        return jsonify(
            {
                "reply": None,
                "gate": True,
                "chat_count": chat_count,
                "limit": FREE_MESSAGE_LIMIT,
            }
        )

    if client is None:
        return jsonify({"error": "Server is missing GEMINI_API_KEY."}), 500

    # Work out who is talking, so the admin dashboard can group messages
    # by person even for guests who never sign up.
    if logged_in:
        person_type = "user"
        person_key = str(session.get("user_id", ""))
        person_name = session.get("name")
        person_email = session.get("email")
    else:
        if "guest_id" not in session:
            session["guest_id"] = uuid.uuid4().hex[:8]
        person_type = "guest"
        person_key = session["guest_id"]
        person_name = f"Guest {person_key}"
        person_email = None

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=message,
            config=types.GenerateContentConfig(
                system_instruction=PROFILE,
                max_output_tokens=320,
                temperature=0.85,
            ),
        )
        reply_text = response.text
    except Exception as exc:  # noqa: BLE001 — surface a clean error to the UI
        return jsonify({"error": f"AI request failed: {exc}"}), 502

    log_message(person_type, person_key, person_name, person_email, message, reply_text)

    if not logged_in:
        chat_count += 1
        session["chat_count"] = chat_count

    return jsonify(
        {
            "reply": reply_text,
            "gate": (not logged_in) and chat_count >= FREE_MESSAGE_LIMIT,
            "chat_count": chat_count,
            "limit": FREE_MESSAGE_LIMIT,
        }
    )


# --------------------------------------------------------------------------
# Routes — auth (site visitors)
# --------------------------------------------------------------------------
@app.route("/api/signup", methods=["POST"])
def api_signup():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not name or not email or not password:
        return jsonify({"error": "Name, email, and password are all required."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "That email is already registered. Try logging in instead."}), 409

    password_hash = generate_password_hash(password)
    created_at = now_iso()
    cur = conn.execute(
        "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (name, email, password_hash, created_at),
    )
    user_id = cur.lastrowid
    conn.execute(
        "INSERT INTO activity_logs (user_id, name, email, event_type, event_time) VALUES (?, ?, ?, ?, ?)",
        (user_id, name, email, "signup", created_at),
    )
    conn.commit()
    conn.close()

    session["logged_in"] = True
    session["user_id"] = user_id
    session["name"] = name
    session["email"] = email
    session["chat_count"] = 0

    return jsonify({"success": True, "name": name})


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        conn.close()
        return jsonify({"error": "Invalid email or password."}), 401

    login_time = now_iso()
    conn.execute(
        "INSERT INTO activity_logs (user_id, name, email, event_type, event_time) VALUES (?, ?, ?, ?, ?)",
        (user["id"], user["name"], user["email"], "login", login_time),
    )
    conn.commit()
    conn.close()

    session["logged_in"] = True
    session["user_id"] = user["id"]
    session["name"] = user["name"]
    session["email"] = user["email"]
    session["chat_count"] = 0

    return jsonify({"success": True, "name": user["name"]})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    # Used for both "log out" and "switch account" — the frontend decides
    # whether to reopen the login form right away.
    session.pop("logged_in", None)
    session.pop("user_id", None)
    session.pop("name", None)
    session.pop("email", None)
    session["chat_count"] = 0
    return jsonify({"success": True})


# --------------------------------------------------------------------------
# Routes — admin auth
# --------------------------------------------------------------------------
@app.route("/api/admin/login", methods=["POST"])
def api_admin_login():
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or "").strip().lower()
    password = data.get("password") or ""

    is_known_identifier = identifier in (ADMIN_USERNAME.lower(), ADMIN_EMAIL.lower())

    if not identifier or not password or not is_known_identifier or not check_password_hash(
        ADMIN_PASSWORD_HASH, password
    ):
        return jsonify({"error": "That username/email or password is not right."}), 401

    session["is_admin"] = True
    session["admin_name"] = ADMIN_DISPLAY_NAME
    return jsonify({"success": True, "name": ADMIN_DISPLAY_NAME})


@app.route("/api/admin/logout", methods=["POST"])
def api_admin_logout():
    session.pop("is_admin", None)
    session.pop("admin_name", None)
    return jsonify({"success": True})


# --------------------------------------------------------------------------
# Routes — admin dashboard data
# --------------------------------------------------------------------------
@app.route("/api/admin/stats")
@admin_required
def api_admin_stats():
    conn = get_db()
    total_users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    total_messages = conn.execute("SELECT COUNT(*) AS c FROM messages").fetchone()["c"]
    total_guests = conn.execute(
        "SELECT COUNT(DISTINCT person_key) AS c FROM messages WHERE person_type = 'guest'"
    ).fetchone()["c"]
    today = datetime.now(timezone.utc).date().isoformat()
    today_signups = conn.execute(
        "SELECT COUNT(*) AS c FROM activity_logs WHERE event_type = 'signup' AND event_time LIKE ?",
        (f"{today}%",),
    ).fetchone()["c"]
    conn.close()
    return jsonify(
        {
            "total_users": total_users,
            "total_messages": total_messages,
            "total_guests": total_guests,
            "today_signups": today_signups,
        }
    )


@app.route("/api/admin/people")
@admin_required
def api_admin_people():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT person_type, person_key, person_name, person_email,
               COUNT(*) AS message_count, MAX(created_at) AS last_active
        FROM messages
        GROUP BY person_type, person_key
        ORDER BY last_active DESC
        """
    ).fetchall()
    conn.close()
    return jsonify({"people": [dict(row) for row in rows]})


@app.route("/api/admin/conversation")
@admin_required
def api_admin_conversation():
    person_type = request.args.get("type", "")
    person_key = request.args.get("key", "")
    if not person_type or not person_key:
        return jsonify({"error": "Missing type or key."}), 400

    conn = get_db()
    rows = conn.execute(
        """
        SELECT message, reply, created_at FROM messages
        WHERE person_type = ? AND person_key = ?
        ORDER BY created_at ASC
        """,
        (person_type, person_key),
    ).fetchall()
    conn.close()
    return jsonify({"messages": [dict(row) for row in rows]})


# --------------------------------------------------------------------------
# Admin — export all visitor/user data to an Excel file
# Protect with a long random ADMIN_EXPORT_KEY set as an environment variable.
# --------------------------------------------------------------------------
@app.route("/admin/export")
def admin_export():
    if request.args.get("key") != ADMIN_EXPORT_KEY:
        return jsonify({"error": "Unauthorized."}), 403

    import pandas as pd  # imported here so the main app doesn't need pandas unless exporting

    conn = get_db()
    users_df = pd.read_sql_query("SELECT id, name, email, created_at FROM users", conn)
    logs_df = pd.read_sql_query(
        "SELECT id, user_id, name, email, event_type, event_time FROM activity_logs ORDER BY event_time DESC",
        conn,
    )
    messages_df = pd.read_sql_query(
        "SELECT id, person_type, person_key, person_name, person_email, message, reply, created_at "
        "FROM messages ORDER BY created_at DESC",
        conn,
    )
    conn.close()

    export_path = "visitor_data_export.xlsx"
    with pd.ExcelWriter(export_path, engine="openpyxl") as writer:
        users_df.to_excel(writer, sheet_name="Users", index=False)
        logs_df.to_excel(writer, sheet_name="Signup_Login_Log", index=False)
        messages_df.to_excel(writer, sheet_name="Messages", index=False)

    return send_file(export_path, as_attachment=True, download_name="prakharbot_visitor_data.xlsx")


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
else:
    # also init when run under gunicorn
    init_db()
