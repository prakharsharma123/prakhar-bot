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
    // Make full http(s) links clickable (text is already HTML-escaped above).
    safe = safe.replace(/(https?:\/\/[^\s<]+?)([.,!?)]*)(?=\s|<|$)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>$2');
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
    if ($("micBtn")) $("micBtn").disabled = true;
  }

  function unlockComposer() {
    const el = $("messageInput");
    el.disabled = false;
    if ($("micBtn")) $("micBtn").disabled = false;
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

  // ---------- voice (free, built into the browser) ----------
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voice = {
    speakReplies: localStorage.getItem("pb-voice") !== "off",
    listening: false,
    keepTalking: false, // true while a voice conversation is going
    rec: null,
    voiceName: localStorage.getItem("pb-voice-name") || "", // "" = automatic
    rate: parseFloat(localStorage.getItem("pb-voice-rate")) || 1,
  };

  function setVoiceStatus(msg) {
    const el = $("voiceStatus");
    if (el) el.textContent = msg || "";
  }

  function speechLang(text) {
    // Hindi in Devanagari gets a Hindi voice, everything else an Indian-English one.
    if (/[ऀ-ॿ]/.test(text || "")) return "hi-IN";
    return "en-IN";
  }

  function cleanForSpeech(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/[`#>*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pickVoice(lang) {
    const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (voice.voiceName) {
      const chosen = voices.find((v) => v.name === voice.voiceName);
      // Use the chosen voice when it can read this language (e.g. don't read Hindi with an English voice).
      if (chosen && chosen.lang.replace("_", "-").slice(0, 2) === lang.slice(0, 2)) return chosen;
    }
    return (
      voices.find((v) => v.lang === lang) ||
      voices.find((v) => v.lang.replace("_", "-").startsWith(lang.slice(0, 2))) ||
      null
    );
  }

  function stopSpeaking() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    $("voiceToggle").classList.remove("speaking");
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!voice.speakReplies || !window.speechSynthesis) return resolve();
      const spoken = cleanForSpeech(text);
      if (!spoken) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(spoken);
      u.lang = speechLang(spoken);
      const v = pickVoice(u.lang);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = voice.rate;
      u.onstart = () => {
        $("voiceToggle").classList.add("speaking");
        setVoiceStatus("Speaking…");
      };
      u.onend = u.onerror = () => {
        $("voiceToggle").classList.remove("speaking");
        setVoiceStatus("");
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  function updateVoiceToggle() {
    $("voiceIconOn").style.display = voice.speakReplies ? "block" : "none";
    $("voiceIconOff").style.display = voice.speakReplies ? "none" : "block";
    $("voiceToggle").setAttribute("aria-pressed", String(voice.speakReplies));
    $("voiceToggle").title = "Spoken replies: " + (voice.speakReplies ? "on" : "off");
  }

  function stopListening() {
    voice.keepTalking = false;
    if (voice.rec) {
      try { voice.rec.stop(); } catch (e) { /* already stopped */ }
    }
  }

  function startListening() {
    if (!SpeechRec || voice.listening || $("messageInput").disabled) return;
    stopSpeaking();
    const rec = new SpeechRec();
    voice.rec = rec;
    rec.lang = navigator.language && navigator.language.startsWith("hi") ? "hi-IN" : "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    const input = $("messageInput");

    rec.onstart = () => {
      voice.listening = true;
      $("micBtn").classList.add("listening");
      setVoiceStatus("Listening… tap the mic to stop");
    };
    rec.onresult = (e) => {
      let t = "";
      for (const r of e.results) t += r[0].transcript;
      input.value = t;
      autoResize(input);
      if (e.results[e.results.length - 1].isFinal) finalText = t;
    };
    rec.onerror = (e) => {
      voice.keepTalking = false;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setVoiceStatus("Microphone is blocked. Allow it in your browser's site settings.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setVoiceStatus("Mic error: " + e.error);
      }
    };
    rec.onend = () => {
      voice.listening = false;
      $("micBtn").classList.remove("listening");
      const text = finalText.trim();
      if (text) {
        input.value = "";
        autoResize(input);
        setVoiceStatus("");
        sendMessage(text, { viaVoice: true });
      } else {
        if (!voice.keepTalking) setVoiceStatus("");
        voice.keepTalking = false;
      }
    };
    try { rec.start(); } catch (e) { /* start called twice */ }
  }

  function populateVoices() {
    const sel = $("voiceSelect");
    if (!sel || !window.speechSynthesis) return;
    const voices = speechSynthesis.getVoices();
    // Indian English and Hindi first, then other English, then everything else.
    const rank = (v) => {
      const l = v.lang.replace("_", "-");
      if (l === "en-IN" || l === "hi-IN") return 0;
      if (l.startsWith("en")) return 1;
      return 2;
    };
    const sorted = voices.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    sel.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Voice: Auto";
    sel.appendChild(auto);
    sorted.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = v.name.replace(/^Microsoft |^Google /, "") + " (" + v.lang + ")";
      sel.appendChild(o);
    });
    sel.value = voice.voiceName;
    if (sel.value !== voice.voiceName) sel.value = "";
  }

  function wireVoice() {
    updateVoiceToggle();

    if (window.speechSynthesis) {
      populateVoices();
      speechSynthesis.onvoiceschanged = populateVoices; // voices often load a moment late
    } else {
      $("voiceSelect").hidden = true;
      $("voiceSpeed").hidden = true;
    }

    $("voiceSelect").addEventListener("change", (e) => {
      voice.voiceName = e.target.value;
      localStorage.setItem("pb-voice-name", voice.voiceName);
      // Play a short sample so you can hear the voice right away.
      const wasOn = voice.speakReplies;
      voice.speakReplies = true;
      speak("Hi, I'm PrakharBot. This is how I sound.").then(() => { voice.speakReplies = wasOn; });
    });

    $("voiceSpeed").value = String(voice.rate);
    if ($("voiceSpeed").value !== String(voice.rate)) $("voiceSpeed").value = "1";
    $("voiceSpeed").addEventListener("change", (e) => {
      voice.rate = parseFloat(e.target.value) || 1;
      localStorage.setItem("pb-voice-rate", String(voice.rate));
    });

    $("voiceToggle").addEventListener("click", () => {
      voice.speakReplies = !voice.speakReplies;
      localStorage.setItem("pb-voice", voice.speakReplies ? "on" : "off");
      if (!voice.speakReplies) stopSpeaking();
      updateVoiceToggle();
    });

    if (!SpeechRec) {
      // Firefox and some browsers: typing still works, spoken replies still work.
      $("micBtn").hidden = true;
      return;
    }

    $("micBtn").addEventListener("click", () => {
      if (voice.listening) { stopListening(); return; }
      voice.keepTalking = true;
      startListening();
    });
  }

  // ---------- sending messages ----------
  async function sendMessage(text, opts) {
    opts = opts || {};
    stopSpeaking();
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

      if (data.reply) {
        await speak(data.reply);
        // In a voice conversation, listen again once the bot finishes talking.
        if (opts.viaVoice && voice.keepTalking && !data.gate) startListening();
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
    stopListening();
    stopSpeaking();
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
    wireVoice();
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
