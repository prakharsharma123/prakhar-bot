(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  // ---------- theme (same behavior as the main site) ----------
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

  // ---------- relative time ----------
  function timeAgo(isoString) {
    if (!isoString) return "—";
    const then = new Date(isoString.replace(" ", "T") + (isoString.endsWith("Z") ? "" : "Z"));
    const seconds = Math.floor((Date.now() - then.getTime()) / 1000);
    if (seconds < 0 || isNaN(seconds)) return "just now";
    if (seconds < 60) return "just now";
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return mins + "m ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    const days = Math.floor(hours / 24);
    return days + "d ago";
  }

  // ---------- stats ----------
  async function loadStats() {
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) return;
      const data = await res.json();
      $("statUsers").textContent = data.total_users;
      $("statGuests").textContent = data.total_guests;
      $("statMessages").textContent = data.total_messages;
      $("statSignups").textContent = data.today_signups;
    } catch (err) {
      /* leave dashes if this fails */
    }
  }

  // ---------- people table ----------
  async function loadPeople() {
    const wrap = $("peopleTableWrap");
    try {
      const res = await fetch("/api/admin/people");
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      const data = await res.json();
      const people = data.people || [];

      if (people.length === 0) {
        wrap.innerHTML = '<div class="empty-state">No one has talked to PrakharBot yet.</div>';
        return;
      }

      let rows = "";
      people.forEach((p) => {
        const isMember = p.person_type === "user";
        const name = p.person_name || (isMember ? "—" : "Guest");
        const email = p.person_email || "—";
        rows +=
          "<tr data-type=\"" + escapeHtml(p.person_type) + "\" data-key=\"" + escapeHtml(p.person_key) + "\">" +
          "<td>" + escapeHtml(name) + "</td>" +
          "<td>" + escapeHtml(email) + "</td>" +
          '<td><span class="badge ' + (isMember ? "member" : "guest") + '">' + (isMember ? "Member" : "Guest") + "</span></td>" +
          "<td>" + p.message_count + "</td>" +
          "<td>" + timeAgo(p.last_active) + "</td>" +
          '<td><button class="btn btn-ghost view-btn">View</button></td>' +
          "</tr>";
      });

      wrap.innerHTML =
        '<table class="people-table"><thead><tr>' +
        "<th>Name</th><th>Email</th><th>Type</th><th>Messages</th><th>Last active</th><th></th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>";

      wrap.querySelectorAll("tr[data-key]").forEach((row) => {
        row.querySelector(".view-btn").addEventListener("click", () => {
          openConversation(row.dataset.type, row.dataset.key, row.children[0].textContent);
        });
      });
    } catch (err) {
      wrap.innerHTML = '<div class="empty-state">Couldn\'t load people right now. Try refreshing.</div>';
    }
  }

  // ---------- conversation viewer ----------
  async function openConversation(type, key, label) {
    $("convTitle").textContent = "Conversation — " + label;
    $("convBody").innerHTML = '<div class="empty-state">Loading…</div>';
    $("convOverlay").classList.add("open");

    try {
      const res = await fetch("/api/admin/conversation?type=" + encodeURIComponent(type) + "&key=" + encodeURIComponent(key));
      const data = await res.json();
      const messages = data.messages || [];
      if (messages.length === 0) {
        $("convBody").innerHTML = '<div class="empty-state">No messages found.</div>';
        return;
      }
      let html = "";
      messages.forEach((m) => {
        html +=
          '<div class="conv-msg"><div class="who">Visitor</div><div class="txt">' + escapeHtml(m.message) + "</div></div>" +
          '<div class="conv-msg"><div class="who">PrakharBot</div><div class="txt">' + escapeHtml(m.reply) + "</div></div>";
      });
      $("convBody").innerHTML = html;
    } catch (err) {
      $("convBody").innerHTML = '<div class="empty-state">Couldn\'t load this conversation.</div>';
    }
  }

  function wireConversationOverlay() {
    $("convClose").addEventListener("click", () => $("convOverlay").classList.remove("open"));
    $("convOverlay").addEventListener("click", (e) => {
      if (e.target === $("convOverlay")) $("convOverlay").classList.remove("open");
    });
  }

  // ---------- logout ----------
  function wireLogout() {
    $("adminLogoutBtn").addEventListener("click", async () => {
      try {
        await fetch("/api/admin/logout", { method: "POST" });
      } catch (err) {
        /* still redirect even if the request hiccups */
      }
      window.location.href = "/admin/login";
    });
  }

  function init() {
    initTheme();
    wireConversationOverlay();
    wireLogout();
    $("refreshBtn").addEventListener("click", () => { loadStats(); loadPeople(); });
    loadStats();
    loadPeople();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
