(function () {
  "use strict";

  const state = {
    loggedIn: false,
    name: null,
    chatCount: 0,
    limit: 6,
  };

  const placeholders = [
    "How can I help you today?",
    "Ask anything about Prakhar",
    "Curious about my projects?",
    "Want to know my tech stack?",
    "Ask about my work experience",
  ];

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatBotText(str) {
    let safe = escapeHtml(str);
    safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/\n/g, "<br>");
    return safe;
  }

  function titleCase(word) {
    if (!word) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  function firstName(fullName) {
    if (!fullName) return "";
    return fullName.trim().split(/\s+/)[0];
  }

  // ---------- theme ----------
  function updateThemeIcon(theme) {
    $("themeIconMoon").style.display = theme === "dark" ? "block" : "none";
    $("themeIconSun").style.display = theme === "light" ? "block" : "none";
  }

  function initTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    updateThemeIcon(current);
    $("themeToggle").addEventListener("click", () => {
      const now = document.documentElement.getAttribute("data-theme") || "dark";
      const next = now === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("pb-theme", next);
      updateThemeIcon(next);
    });
  }

  // ---------- greeting ----------
  function computeGreeting() {
    const hour = new Date().getHours();
    let base;
    if (hour >= 5 && hour < 12) base = "Good morning";
    else if (hour >= 12 && hour < 17) base = "Good afternoon";
    else if (hour >= 17 && hour < 21) base = "Good evening";
    else base = "Still up?";

    if (state.loggedIn && state.name) {
      return base + ", " + titleCase(firstName(state.name));
    }
    return base;
  }

  function renderGreeting() {
    $("heroGreeting").innerHTML = '<span class="prompt-mark">&gt;</span>' + escapeHtml(computeGreeting());
  }

  // ---------- placeholder rotation ----------
  function startPlaceholderRotation() {
    let i = 0;
    setInterval(() => {
      const el = $("messageInput");
      if (!el || el.disabled || document.activeElement === el || el.value) return;
      i = (i + 1) % placeholders.length;
      el.setAttribute("placeholder", placeholders[i]);
    }, 3200);
  }

  // ---------- composer ----------
  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function lockComposer(placeholderText) {
    const el = $("messageInput");
    el.disabled = true;
    el.setAttribute("placeholder", placeholderText || "Sign up to keep chatting");
  }

  function unlockComposer() {
    const el = $("messageInput");
    el.disabled = false;
    el.setAttribute("placeholder", placeholders[0]);
  }

  // ---------- chat view state ----------
  function showChatView() {
    $("heroView").style.display = "none";
    $("messageList").style.display = "block";
  }

  function showHeroView() {
    $("heroView").style.display = "flex";
    $("messageList").style.display = "none";
  }

  function scrollToBottom() {
    const list = $("messageList");
    list.scrollTop = list.scrollHeight;
  }

  function appendMessage(role, text) {
    const inner = $("messageInner");
    const row = document.createElement("div");
    row.className = "msg-row from-" + role;

    if (role === "bot") {
      const avatar = document.createElement("div");
      avatar.className = "msg-avatar";
      avatar.textContent = ">";
      row.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = role === "bot" ? formatBotText(text) : escapeHtml(text);
    row.appendChild(bubble);

    inner.appendChild(row);
    scrollToBottom();
    return row;
  }

  function appendSystemMessage(text) {
    const inner = $("messageInner");
    const row = document.createElement("div");
    row.className = "msg-row from-system";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    inner.appendChild(row);
    scrollToBottom();
  }

  function appendTyping() {
    const inner = $("messageInner");
    const row = document.createElement("div");
    row.className = "msg-row from-bot";
    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = ">";
    row.appendChild(avatar);
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    row.appendChild(bubble);
    inner.appendChild(row);
    scrollToBottom();
    return row;
  }

  function appendGateCard() {
    const inner = $("messageInner");
    const card = document.createElement("div");
    card.className = "gate-card";
    card.innerHTML =
      "That's the free preview limit for now. Sign up or log in and I'll keep answering." +
      '<br><button class="btn btn-primary" id="gateAuthBtn">Sign up / Log in</button>';
    inner.appendChild(card);
    scrollToBottom();
    $("gateAuthBtn").addEventListener("click", () => openAuthModal("signup"));
  }

  // ---------- sending messages ----------
  async function sendMessage(text) {
    appendMessage("user", text);
    showChatView();
    const typingRow = appendTyping();

    try {
      const [res] = await Promise.all([
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        }),
        sleep(450 + Math.random() * 500),
      ]);
      const data = await res.json();
      typingRow.remove();

      if (!res.ok) {
        appendSystemMessage(data.error || "Something went wrong on my end. Try again in a bit.");
        return;
      }

      if (data.reply) {
        appendMessage("bot", data.reply);
        state.chatCount = data.chat_count;
      }

      if (data.gate) {
        appendGateCard();
        lockComposer("Sign up to keep chatting");
      }
    } catch (err) {
      typingRow.remove();
      appendSystemMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  function wireComposer() {
    const input = $("messageInput");
    input.addEventListener("input", () => autoResize(input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("composerForm").requestSubmit();
      }
    });
    $("composerForm").addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.disabled) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      autoResize(input);
      sendMessage(text);
    });
  }

  // ---------- auth area (top right) ----------
  function renderAuthArea() {
    const el = $("authArea");
    if (state.loggedIn) {
      const first = titleCase(firstName(state.name) || "?");
      el.innerHTML =
        '<div class="user-chip">' +
        '<button class="user-chip-btn" id="userChipBtn"><span class="avatar">' +
        escapeHtml(first.charAt(0)) +
        '</span><span>' + escapeHtml(first) + '</span></button>' +
        '<div class="dropdown" id="userDropdown">' +
        '<button class="dropdown-item" id="switchAccountBtn">Switch account</button>' +
        '<button class="dropdown-item danger" id="logoutBtn">Log out</button>' +
        "</div></div>";

      $("userChipBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        $("userDropdown").classList.toggle("open");
      });
      $("switchAccountBtn").addEventListener("click", async () => {
        await doLogout();
        openAuthModal("login");
      });
      $("logoutBtn").addEventListener("click", doLogout);
    } else {
      el.innerHTML =
        '<button class="btn btn-ghost" id="loginNavBtn">Log in</button>' +
        '<button class="btn btn-primary" id="signupNavBtn">Sign up</button>';
      $("loginNavBtn").addEventListener("click", () => openAuthModal("login"));
      $("signupNavBtn").addEventListener("click", () => openAuthModal("signup"));
    }
  }

  async function doLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch (err) {
      /* ignore network hiccup, still reset UI locally */
    }
    state.loggedIn = false;
    state.name = null;
    state.chatCount = 0;
    $("messageInner").innerHTML = "";
    showHeroView();
    unlockComposer();
    renderGreeting();
    renderAuthArea();
  }

  // ---------- auth modal ----------
  function clearAuthError() {
    const err = $("authError");
    err.textContent = "";
    err.classList.remove("show");
  }

  function showAuthError(msg) {
    const err = $("authError");
    err.textContent = msg;
    err.classList.add("show");
  }

  function setAuthTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".auth-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab));
    $("authTitle").textContent = tab === "login" ? "Welcome back" : "Create your account";
    clearAuthError();
  }

  function openAuthModal(tab) {
    setAuthTab(tab || "login");
    $("authModal").classList.add("open");
    setTimeout(() => {
      const target = tab === "signup" ? $("signupName") : $("loginEmail");
      if (target) target.focus();
    }, 50);
  }

  function closeAuthModal() {
    $("authModal").classList.remove("open");
    clearAuthError();
  }

  function wireAuthModal() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => setAuthTab(btn.dataset.tab));
    });
    $("authClose").addEventListener("click", closeAuthModal);
    $("authModal").addEventListener("click", (e) => {
      if (e.target === $("authModal")) closeAuthModal();
    });

    $("loginPanel").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthError();
      const email = $("loginEmail").value.trim();
      const password = $("loginPassword").value;
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) { showAuthError(data.error || "Couldn't log you in."); return; }
        state.loggedIn = true;
        state.name = data.name;
        state.chatCount = 0;
        closeAuthModal();
        unlockComposer();
        renderAuthArea();
        renderGreeting();
        $("loginPanel").reset();
      } catch (err) {
        showAuthError("Couldn't reach the server. Try again.");
      }
    });

    $("signupPanel").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthError();
      const name = $("signupName").value.trim();
      const email = $("signupEmail").value.trim();
      const password = $("signupPassword").value;
      try {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (!res.ok) { showAuthError(data.error || "Couldn't create your account."); return; }
        state.loggedIn = true;
        state.name = data.name;
        state.chatCount = 0;
        closeAuthModal();
        unlockComposer();
        renderAuthArea();
        renderGreeting();
        $("signupPanel").reset();
      } catch (err) {
        showAuthError("Couldn't reach the server. Try again.");
      }
    });

    document.addEventListener("click", (e) => {
      const dd = $("userDropdown");
      if (dd && dd.classList.contains("open") && !e.target.closest(".user-chip")) {
        dd.classList.remove("open");
      }
    });
  }

  // ---------- boot ----------
  async function init() {
    initTheme();
    wireComposer();
    wireAuthModal();
    startPlaceholderRotation();

    try {
      const res = await fetch("/api/session");
      const data = await res.json();
      state.loggedIn = data.logged_in;
      state.name = data.name;
      state.chatCount = data.chat_count;
      state.limit = data.limit;
    } catch (err) {
      /* stay in guest state if this fails */
    }

    renderAuthArea();
    renderGreeting();

    if (!state.loggedIn && state.chatCount >= state.limit) {
      lockComposer("Sign up to keep chatting");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
