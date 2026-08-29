# PrakharBot — AI chat portfolio site

A terminal-styled portfolio site with an AI assistant (powered by Gemini) that answers
questions about you using your resume as context, and talks like an actual person —
short, warm, plain-English replies instead of a corporate assistant. Guests get 6 free
messages, then the bot asks them to sign up or log in before it keeps answering. Every
chat message, signup, and login is logged to a SQLite database, and you (Prakhar) have
your own admin dashboard to see who's been talking to the bot — plus an Excel export if
you want a copy of it all.

```
prakhar-bot/
├── app.py                       # Flask backend (chat, auth, admin, export)
├── resume_data.py               # Your bio/skills/projects + the bot's tone of voice
├── requirements.txt
├── templates/
│   ├── index.html               # Main chat page
│   ├── admin_login.html         # /admin/login
│   └── admin_dashboard.html     # /admin/dashboard
├── static/
│   ├── style.css                # Shared dark/light theme for both site + admin
│   ├── script.js                # Chat UI: greeting, placeholder rotation, auth, chat
│   └── admin.js                 # Admin dashboard: stats, people list, conversation viewer
└── chatbot.db                   # created automatically on first run
```

### What's new in this version

- **Admin login & dashboard.** You log in at `/admin/login` with a username or email plus
  a password (separate from regular visitor accounts). The dashboard at
  `/admin/dashboard` shows stat cards (members, guests, total messages, signups today)
  and a table of every person who's chatted — click **View** on any row to read the full
  back-and-forth in a slide-over panel.
- **Every chat message is logged**, not just signups/logins, in a new `messages` table
  (`person_type`, `person_key`, name/email if known, the message, the reply, timestamp).
  Guests get a short random ID so their messages are grouped together even before they
  sign up.
- **Log out / switch account.** Once someone is logged in, clicking their name in the
  top-right opens a small menu with **Switch account** (logs out and immediately reopens
  the login form) and **Log out** (back to guest mode).
- **A more human bot.** `resume_data.py` now tells the bot to keep answers short (2–4
  sentences unless someone wants detail), use plain English, show a bit of real
  personality, and never use emojis. `app.py` also passes this as the model's
  `system_instruction` and caps the reply length so it doesn't ramble.
- **New look.** Clean dark/light theme (toggle top-right, remembered in the browser),
  a time-of-day greeting that uses your first name when someone's logged in, a small
  "PRAKHAR_BOT" terminal-style brand mark, and a chat box with a placeholder that
  rotates through a few different prompts.

---

## 1. About that exposed API key

You pasted your real Gemini API key in our chat earlier, so treat it as compromised:

1. Go to **Google AI Studio → API keys**.
2. Delete/revoke that key.
3. Generate a new one and keep it **only** in an environment variable — never in code
   you commit to GitHub or paste anywhere.

`app.py` no longer has any key hardcoded, not even as a fallback — `GEMINI_API_KEY`
must be set as an environment variable or the chat feature simply won't work (you'll
get a clear "Server is missing GEMINI_API_KEY" message instead of a silent leak).

---

## 2. Run it locally

**Requirements:** Python 3.10+

**macOS/Linux (bash):**
```bash
cd prakhar-bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```


**Windows (PowerShell)** — `source` doesn't exist in PowerShell, use this instead:
```powershell
cd prakhar-bot
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
If you get a "running scripts is disabled on this system" error, run PowerShell as
Administrator once and allow local scripts:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
Then re-run `.\venv\Scripts\Activate.ps1`. Your prompt should show `(venv)` at the
start once it's active.

### Troubleshooting: pandas fails to install / "Could not find vswhere.exe"

If `pip install -r requirements.txt` fails while building `pandas` from source (a
`meson`/`vswhere.exe` error, usually on newer Python versions on Windows), it means pip
couldn't find a pre-built wheel and tried to compile it — which needs Visual Studio
build tools you don't have. This is now avoided in `requirements.txt` (pandas/openpyxl
are unpinned so pip grabs a version with a ready-made wheel), but if it still happens:

```powershell
pip install --only-binary :all: pandas openpyxl
```

Since `pandas` is only used for the optional Excel export feature, you can also just
skip it entirely for now and install the rest:
```powershell
pip install Flask google-genai Werkzeug gunicorn
```
The app runs fine without pandas — you'd only lose the `/admin/export` route until you
install it later.

Create a `.env`-style setup by exporting these environment variables (or use a `.env`
file with `python-dotenv` if you prefer):

```bash
export GEMINI_API_KEY="your-new-key-here"
export FLASK_SECRET_KEY="a-long-random-string"
export ADMIN_EXPORT_KEY="another-long-random-string"
export GEMINI_MODEL="gemini-2.5-flash"     # check Google AI Studio for the current model name
export FREE_MESSAGE_LIMIT="6"

# Your admin login (for /admin/login) — change all of these before deploying
export ADMIN_USERNAME="prakhar"
export ADMIN_EMAIL="prakharsharmawork1@gmail.com"
export ADMIN_PASSWORD="Prakhar@123"
export ADMIN_DISPLAY_NAME="Prakhar Sharma"
```

On Windows PowerShell, use `$env:GEMINI_API_KEY="..."` instead of `export`.

If you don't set the `ADMIN_*` variables, the app falls back to username `prakhar`,
email `prakharsharmawork1@gmail.com`, and password `Prakhar@123` — fine for trying it
out locally, but change the password before this ever goes on the internet.

Run it:

```bash
python app.py
```

Visit **http://localhost:5000**. The SQLite file `chatbot.db` is created automatically
on first run.

---

## 3. How the pieces work

- **Chat** (`/api/chat`): sends `resume_data.py` as the model's `system_instruction`
  (both the facts about you and the "talk like a real person" tone rules) plus the
  visitor's message as the prompt, and returns the answer. Every message and reply is
  written to the `messages` table right away, tagged with who sent it.
- **Guests vs. members**: a guest is given a short random ID (stored in their session
  cookie) the first time they chat, so all their messages stay grouped together in the
  admin dashboard even if they never sign up. Once someone signs up or logs in, their
  messages are tagged with their real name and email instead.
- **Gate**: once a guest hits `FREE_MESSAGE_LIMIT` (default 6) without logging in, the
  chat endpoint stops calling the AI and tells the frontend `"gate": true`, which shows
  a "sign up to keep chatting" prompt.
- **Signup / Login** (`/api/signup`, `/api/login`): stores `name`, `email`, a hashed
  password (never plain text) in the `users` table, and appends a row to
  `activity_logs` with `event_type` (`signup` or `login`) and a UTC timestamp.
- **Logout / switch account** (`/api/logout`): clears the visitor's session and resets
  their free-message count, so a fresh guest session (or a different account) can start
  clean.
- **Admin login** (`/api/admin/login`, `/admin/login`): a single admin account (you),
  checked against the `ADMIN_*` environment variables — accepts either the username or
  the email plus the password.
- **Admin dashboard** (`/admin/dashboard`): stat cards plus a table of every person
  who's chatted, pulled from `/api/admin/people` (grouped from the `messages` table).
  Clicking **View** calls `/api/admin/conversation` to show that person's full
  back-and-forth.
- **Export** (`/admin/export?key=YOUR_ADMIN_EXPORT_KEY`): generates and downloads an
  `.xlsx` with three sheets — `Users`, `Signup_Login_Log`, and `Messages` — so you
  always have an Excel copy of everyone who's talked to the bot. Keep `ADMIN_EXPORT_KEY`
  secret; anyone with it can download your visitor data.

To update what the bot knows about you (new project, new job, etc.) or how it talks,
just edit the text in `resume_data.py` — no code changes needed elsewhere.

---

## 4. Deploy it for real — Render (matches the stack on your resume)

Render is a good fit since you're already using it for other projects.

1. **Push the project to GitHub** (make sure `.env`/keys are *not* committed — the
   included `.gitignore` already excludes them):
   ```bash
   git init
   git add .
   git commit -m "Initial commit — PrakharBot"
   git branch -M main
   git remote add origin https://github.com/<you>/prakhar-bot.git
   git push -u origin main
   ```

2. **Create the service on Render:**
   - Go to [render.com](https://render.com) → **New → Web Service**.
   - Connect your GitHub repo.
   - **Runtime:** Python 3.
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `gunicorn app:app`

3. **Add environment variables** in Render's dashboard (Settings → Environment):
   - `GEMINI_API_KEY`
   - `FLASK_SECRET_KEY`
   - `ADMIN_EXPORT_KEY`
   - `GEMINI_MODEL`
   - `FREE_MESSAGE_LIMIT`
   - `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME` — this is
     how you'll log into `/admin/login` on the live site, so use a real password here,
     not the `changeme123` default.

4. **Persistent storage note:** Render's free/standard web services use an ephemeral
   filesystem — `chatbot.db` can be wiped on redeploys. For a portfolio demo this is
   usually fine, but if you want signup data to survive redeploys long-term:
   - Add a Render **Persistent Disk** (Settings → Disks) mounted at, say, `/data`, and
     set `DB_PATH=/data/chatbot.db` as an env variable, **or**
   - Swap SQLite for Render's free **PostgreSQL** add-on later (bigger change, ask me
     if you want that version).

5. Click **Deploy**. Render gives you a live URL like
   `https://prakhar-bot.onrender.com` — put that in your LinkedIn/GitHub bio.

### Alternative: your own VPS (Gunicorn + Nginx — you already know this from your resume)

```bash
# on the server
git clone https://github.com/<you>/prakhar-bot.git
cd prakhar-bot
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY=... FLASK_SECRET_KEY=... ADMIN_EXPORT_KEY=...
gunicorn --bind 127.0.0.1:8000 app:app
```

Then point an Nginx server block at `127.0.0.1:8000` and run Certbot for SSL, the same
way you set up mahadevfitnessclub.in.

---

## 5. Checking / exporting your visitor data

- **Dashboard (easiest):** visit `https://your-domain.com/admin/login`, log in with
  your `ADMIN_*` credentials, and you'll see everyone who's chatted, how many messages
  they sent, and a **View** button for the full transcript.
- **Raw peek** (from the server):
  ```bash
  sqlite3 chatbot.db "SELECT * FROM users;"
  sqlite3 chatbot.db "SELECT * FROM activity_logs ORDER BY event_time DESC;"
  sqlite3 chatbot.db "SELECT * FROM messages ORDER BY created_at DESC;"
  ```
- **Excel download:** visit
  `https://your-domain.com/admin/export?key=YOUR_ADMIN_EXPORT_KEY` in a browser — it
  downloads `prakharbot_visitor_data.xlsx` with `Users`, `Signup_Login_Log`, and
  `Messages` sheets.

---

## 6. Things worth doing next (optional)

- Rate-limit `/api/chat` per IP (e.g. with `Flask-Limiter`) so one visitor can't spam
  your Gemini quota.
- Add email verification on signup if you want to be sure emails are real.
- Swap SQLite → PostgreSQL if you deploy somewhere with an ephemeral disk long-term.
- Add pagination to the admin people list once you have a lot of visitors — right now
  it loads everyone in one request, which is fine for a portfolio site but wouldn't
  scale to thousands of chats.
