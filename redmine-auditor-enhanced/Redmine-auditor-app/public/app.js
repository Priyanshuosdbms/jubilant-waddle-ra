// ─── State ────────────────────────────────────────────────────────────────────
let latestData     = null;
let lastSummary    = "";
let lastReview     = "";
let lastPolished   = "";
let lastDraft      = "";
let activeTab      = "single";
const summaryCache = {};

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + tab).classList.add("active");
    activeTab = tab;
    if (tab === "bulk")  { loadBulkSummaries(); startBulkPoll(); }
    else                 { stopBulkPoll(); }
    if (tab === "notes") { loadAllNotes(); }
  });
});

// ─── postMessage from content.js ─────────────────────────────────────────────
window.addEventListener("message", (event) => {
  if (!event.data || !event.data.action) return;
  const { action } = event.data;

  // Summarize started (pill clicked, split just opened) — show loading overlay
  if (action === "summarizeStarted") {
    showEl("ra-loading-overlay");
    document.getElementById("ra-loading-msg").textContent = "Summarizing ticket…";
    // Switch to single tab so the result lands in the right place
    document.querySelector("[data-tab='single']").click();
  }

  if (action === "summarizeFailed") {
    hideEl("ra-loading-overlay");
    showStatus("Summarize failed: " + (event.data.error || "unknown error"), true);
  }

  if (action === "showSummary") {
    hideEl("ra-loading-overlay");
    lastSummary = event.data.summary;
    if (event.data.ticketData) latestData = event.data.ticketData;
    renderAiOutput("🧠 AI Summary", lastSummary);
    document.querySelector("[data-tab='single']").click();
    // Refresh ticket header in case this is a first load
    if (latestData) {
      renderTicketHeader();
      renderTimeEstimate(latestData);
      loadPersonalNote(latestData.ticketId);
      loadAssigneeSnapshot(latestData.assignee);
    }
  }

  if (action === "showReview") {
    lastReview = event.data.review;
    renderReview(lastReview);
    document.querySelector("[data-tab='single']").click();
  }

  if (action === "showPolished") {
    lastPolished = event.data.polished;
    lastDraft    = event.data.draft || "";
    renderPolished(lastPolished, lastDraft);
    document.querySelector("[data-tab='single']").click();
  }
});

// ─── Fetch / LLM helpers ──────────────────────────────────────────────────────
async function fetchLatest() {
  const r = await fetch("/latest");
  return r.json();
}

async function callLLM(systemPrompt, userContent, maxTokens = 1024) {
  const r = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, userContent, maxTokens })
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.error || "LLM error");
  return d.text;
}

// ─── Load / Refresh ───────────────────────────────────────────────────────────
document.getElementById("loadBtn").addEventListener("click", loadTicket);

async function loadTicket() {
  try {
    latestData = await fetchLatest();
    renderTicketHeader();
    renderTimeEstimate(latestData);
    loadPersonalNote(latestData.ticketId);
    loadAssigneeSnapshot(latestData.assignee);
    if (lastSummary) renderAiOutput("🧠 AI Summary", lastSummary);
    else hideEl("ai-output");
    hideEl("review-panel");
    hideEl("polish-panel");
    hideEl("timeline-panel");
    hideEl("sentiment-panel");
    document.getElementById("contentArea").innerHTML = "";
    showStatus("Ticket loaded.");
  } catch (e) {
    showStatus("Could not load ticket: " + e.message, true);
  }
}

function renderTicketHeader() {
  if (!latestData) return;
  document.getElementById("ticket-title").textContent = latestData.title || "Untitled";
  const link = document.getElementById("ticket-url");
  link.href        = latestData.url || "#";
  link.textContent = latestData.url || "";
  showEl("ticket-header");
}

// ─── Assignee workload snapshot ───────────────────────────────────────────────
async function loadAssigneeSnapshot(assignee) {
  if (!assignee) { hideEl("assignee-snapshot"); return; }
  try {
    const r    = await fetch("/assignee-data/" + encodeURIComponent(assignee));
    const data = await r.json();
    document.getElementById("assignee-name").textContent = "👤 " + assignee;
    const count    = data.ticketCount || 0;
    const countEl  = document.getElementById("assignee-count");
    countEl.textContent = count + " ticket" + (count !== 1 ? "s" : "") + " seen";
    countEl.className   = "assignee-count " +
      (count <= 3 ? "load-low" : count <= 6 ? "load-mid" : "load-high");
    showEl("assignee-snapshot");
  } catch (_) {
    hideEl("assignee-snapshot");
  }
}

// ─── Time estimator ───────────────────────────────────────────────────────────
function renderTimeEstimate(data) {
  if (!data || !data.notes || data.notes.length === 0) { hideEl("time-estimate"); return; }

  const dated = data.notes
    .map(n => ({ author: n.author, date: parseNoteDate(n.date) }))
    .filter(n => n.date !== null)
    .sort((a, b) => a.date - b.date);

  if (dated.length === 0) { hideEl("time-estimate"); return; }

  const now           = Date.now();
  const first         = dated[0].date;
  const last          = dated[dated.length - 1].date;
  const totalDays     = Math.round((last - first) / 86400000);
  const daysSinceLast = Math.round((now - last) / 86400000);
  const stalled       = daysSinceLast > 7;

  let gapsHTML = "";
  for (let i = 1; i < dated.length; i++) {
    const gap = Math.round((dated[i].date - dated[i - 1].date) / 86400000);
    if (gap > 0) {
      gapsHTML += `<div class="time-gap-row">
        <span class="time-gap-who">${esc(dated[i].author)}</span>
        <span class="time-gap-arrow">↳ after ${gap}d</span>
        <span class="time-gap-date">${fmtDate(dated[i].date)}</span>
      </div>`;
    }
  }

  document.getElementById("time-estimate-body").innerHTML = `
    <div class="time-stats">
      <div class="time-stat">
        <span class="time-stat-val">${totalDays}d</span>
        <span class="time-stat-label">total span</span>
      </div>
      <div class="time-stat">
        <span class="time-stat-val">${dated.length}</span>
        <span class="time-stat-label">updates</span>
      </div>
      <div class="time-stat ${stalled ? "stalled" : "active"}">
        <span class="time-stat-val">${daysSinceLast}d</span>
        <span class="time-stat-label">${stalled ? "⚠️ stalled" : "since last"}</span>
      </div>
    </div>
    ${gapsHTML ? `<div class="time-gaps">${gapsHTML}</div>` : ""}`;
  showEl("time-estimate");
}

function parseNoteDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" });
}

// ─── AI Summarize ─────────────────────────────────────────────────────────────
document.getElementById("summarizeBtn").addEventListener("click", async () => {
  if (!latestData) { latestData = await fetchLatest().catch(() => null); }
  if (!latestData || !latestData.title) {
    showStatus("No ticket data. Click Refresh first.", true); return;
  }
  const btn = document.getElementById("summarizeBtn");
  btn.textContent = "⏳ Summarizing…";
  btn.disabled    = true;
  try {
    const notesText = buildNotesText(latestData.notes);
    const system = `You are a Redmine ticket analyst. Given a ticket, produce:
1. A concise 3-5 sentence summary.
2. Task completion analysis: for each proposed task/requirement state whether COMPLETED (with date if available) or PENDING (with reason if known).
3. Final scorecard line: "X of Y tasks completed. Z pending."
Use clear formatting.`;
    const user    = `Ticket: ${latestData.title}\nURL: ${latestData.url}\n\nDescription:\n${latestData.description}\n\nHistory:\n${notesText || "None"}`;
    const summary = await callLLM(system, user, 1200);
    lastSummary   = summary;
    if (latestData.ticketId) summaryCache[latestData.ticketId] = summary;
    renderAiOutput("🧠 AI Summary", summary);
  } catch (e) {
    showStatus("Summarize failed: " + e.message, true);
  } finally {
    btn.textContent = "🧠 Summarize";
    btn.disabled    = false;
  }
});

// ─── Show Details ─────────────────────────────────────────────────────────────
document.getElementById("evaluateBtn").addEventListener("click", async () => {
  if (!latestData) { latestData = await fetchLatest().catch(() => null); }
  if (!latestData) { showStatus("No data loaded.", true); return; }

  let notesHTML = "";
  if (latestData.notes && latestData.notes.length) {
    latestData.notes.forEach(note => {
      notesHTML += `<div class="note">
        <div class="note-meta"><strong>${esc(note.author)}</strong>${note.date ? " · " + esc(note.date) : ""}</div>
        <div class="note-content">${esc(note.content)}</div>
      </div>`;
    });
  } else {
    notesHTML = "<em>No notes.</em>";
  }

  document.getElementById("contentArea").innerHTML = `
    <div class="card">
      <div class="section-label">Description</div>
      <div class="description-text">${esc(latestData.description)}</div>
    </div>
    <div class="card">
      <div class="section-label">History / Notes</div>
      ${notesHTML}
    </div>`;
});

// ─── Status Changelog Timeline ────────────────────────────────────────────────
// BUG FIX: every event now shows its date. "Opened" uses createdDate from
// the DOM (extracted by content.js), all subsequent events use note.date.
// If no date is available for any event, it shows "No date" rather than blank.
document.getElementById("timelineBtn").addEventListener("click", async () => {
  if (!latestData) { latestData = await fetchLatest().catch(() => null); }
  if (!latestData) { showStatus("No data loaded.", true); return; }

  const events = buildTimelineEvents(latestData);
  if (!events.length) {
    showStatus("No status changes found in this ticket's history.", true); return;
  }

  const html = events.map((ev, i) => `
    <div class="tl-item">
      <div class="tl-dot ${ev.type}"></div>
      <div class="tl-line ${i === events.length - 1 ? "tl-line-last" : ""}"></div>
      <div class="tl-content">
        <div class="tl-header">
          <span class="tl-status ${ev.type}">${esc(ev.status)}</span>
          <span class="tl-date">${esc(ev.date || "No date")}</span>
        </div>
        <div class="tl-author">by ${esc(ev.author)}</div>
        ${ev.detail ? `<div class="tl-detail">${esc(ev.detail)}</div>` : ""}
      </div>
    </div>`).join("");

  document.getElementById("timeline-body").innerHTML = `<div class="timeline">${html}</div>`;
  showEl("timeline-panel");
});

function buildTimelineEvents(data) {
  const events = [];

  // Opening event — use the real ticket creation date from the DOM if available
  const openedDate = data.createdDate
    || (data.notes && data.notes[0] ? data.notes[0].date : "")
    || "";

  events.push({
    status: "Opened",
    date:   openedDate,
    author: "Reporter",
    detail: "",
    type:   "opened"
  });

  (data.notes || []).forEach(note => {
    // Status changes extracted by content.js from journal detail lines
    (note.statusChanges || []).forEach(change => {
      events.push({
        status: extractNewStatus(change) || "Status changed",
        date:   note.date || "",   // always populated from note's own date
        author: note.author,
        detail: change,
        type:   classifyStatus(change)
      });
    });

    // Fallback: catch status-change language in note body text
    if (!note.statusChanges || !note.statusChanges.length) {
      const matches = (note.content || "").match(
        /status.*?changed.*?from\s+\S+\s+to\s+(\S+)/gi
      );
      if (matches) {
        matches.forEach(m => {
          events.push({
            status: extractNewStatus(m) || "Status changed",
            date:   note.date || "",
            author: note.author,
            detail: "",
            type:   classifyStatus(m)
          });
        });
      }
    }
  });

  return events;
}

function extractNewStatus(changeText) {
  const m = (changeText || "").match(/to\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function classifyStatus(text) {
  const t = (text || "").toLowerCase();
  if (/resolv|fix|clos|done|complet/.test(t)) return "resolved";
  if (/reject|invalid|wont/.test(t))          return "rejected";
  if (/progress|started|work/.test(t))         return "progress";
  if (/open|new|reopen/.test(t))               return "opened";
  return "neutral";
}

// ─── Sentiment Tracker ────────────────────────────────────────────────────────
document.getElementById("sentimentBtn").addEventListener("click", async () => {
  if (!latestData) { latestData = await fetchLatest().catch(() => null); }
  if (!latestData) { showStatus("No data loaded.", true); return; }

  const btn = document.getElementById("sentimentBtn");

  try {
    const cached = await fetch("/sentiment/" + latestData.ticketId).then(r => r.json());
    if (cached && cached.result) {
      document.getElementById("sentiment-body").innerHTML = markdownLite(cached.result);
      showEl("sentiment-panel");
      showStatus("Sentiment loaded from cache.");
      return;
    }
  } catch (_) {}

  if (!latestData.notes || !latestData.notes.length) {
    showStatus("No notes to analyse sentiment on.", true); return;
  }

  btn.textContent = "⏳ Analysing…";
  btn.disabled    = true;

  try {
    const notesText = latestData.notes
      .map((n, i) => `[Note ${i + 1} by ${n.author}${n.date ? " on " + n.date : ""}]:\n${n.content}`)
      .join("\n\n");

    const system = `You are a Redmine ticket tone analyst. Given a series of ticket notes, analyse the sentiment of each note and the overall trajectory.
For each note, output: Note N — [Positive / Neutral / Frustrated / Urgent / Resolved] — one short reason.
End with: "Overall: <label> — <one sentence explaining the trend>"
Be concise.`;

    const result = await callLLM(system,
      `Ticket: ${latestData.title}\n\nNotes:\n${notesText}`, 700);

    await fetch("/sentiment/" + latestData.ticketId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result })
    }).catch(() => {});

    document.getElementById("sentiment-body").innerHTML = markdownLite(result);
    showEl("sentiment-panel");
  } catch (e) {
    showStatus("Sentiment analysis failed: " + e.message, true);
  } finally {
    btn.textContent = "😐 Sentiment";
    btn.disabled    = false;
  }
});

// ─── Polished draft ───────────────────────────────────────────────────────────
function renderPolished(polished, originalDraft) {
  document.getElementById("polish-original").innerHTML =
    "<strong>Your draft:</strong><br>" + esc(originalDraft);
  document.getElementById("polish-body").innerHTML = markdownLite(polished);
  showEl("polish-panel");
}

document.getElementById("copyPolishBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(lastPolished).then(() => showStatus("Copied!"));
});

document.getElementById("usePolishBtn").addEventListener("click", () => {
  if (!lastPolished) return;
  window.parent.postMessage({ action: "fillEditArea", text: lastPolished }, "*");
  showStatus("Polished text sent to the edit field.");
});

// ─── AI output / review ───────────────────────────────────────────────────────
function renderAiOutput(label, text) {
  document.getElementById("ai-output-label").textContent = label;
  document.getElementById("ai-output-body").innerHTML    = markdownLite(text);
  showEl("ai-output");
}

function renderReview(text) {
  document.getElementById("review-body").innerHTML = markdownLite(text);
  showEl("review-panel");
}

document.getElementById("copyAiBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(lastSummary).then(() => showStatus("Copied!"));
});

document.getElementById("copyReviewBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(lastReview).then(() => showStatus("Copied!"));
});

// ─── Personal notes (current ticket) ─────────────────────────────────────────
async function loadPersonalNote(ticketId) {
  if (!ticketId) return;
  try {
    const r    = await fetch("/personal-notes/" + ticketId);
    const data = await r.json();
    document.getElementById("personal-note-area").value = data.text || "";
    document.getElementById("note-status").textContent  = data.updatedAt
      ? "Last saved: " + new Date(data.updatedAt).toLocaleString()
      : "";
  } catch (_) {}
}

document.getElementById("saveNoteBtn").addEventListener("click", async () => {
  if (!latestData || !latestData.ticketId) {
    showStatus("Load a ticket first.", true); return;
  }
  const text = document.getElementById("personal-note-area").value;
  try {
    await fetch("/personal-notes/" + latestData.ticketId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Now sends title + url so the All Notes view can link back
      body: JSON.stringify({
        text,
        title: latestData.title || ("Ticket #" + latestData.ticketId),
        url:   latestData.url   || ""
      })
    });
    document.getElementById("note-status").textContent =
      "Saved: " + new Date().toLocaleString();
    showStatus("Note saved.");
  } catch (e) {
    showStatus("Could not save note: " + e.message, true);
  }
});

document.getElementById("deleteNoteBtn").addEventListener("click", async () => {
  if (!latestData || !latestData.ticketId) return;
  if (!confirm("Delete your personal note for this ticket?")) return;
  try {
    await fetch("/personal-notes/" + latestData.ticketId, { method: "DELETE" });
    document.getElementById("personal-note-area").value = "";
    document.getElementById("note-status").textContent  = "";
    showStatus("Note deleted.");
  } catch (e) {
    showStatus("Could not delete note: " + e.message, true);
  }
});

// ─── All Personal Notes tab ───────────────────────────────────────────────────
document.getElementById("refreshNotesBtn").addEventListener("click", loadAllNotes);

async function loadAllNotes() {
  const list = document.getElementById("notes-list");
  try {
    const r    = await fetch("/personal-notes");
    const data = await r.json();
    const notes = data.notes || [];

    if (!notes.length) {
      list.innerHTML = `<div class="empty-state">
        No personal notes saved yet.<br>Open a ticket, write a note, and click Save.
      </div>`;
      return;
    }

    list.innerHTML = notes.map(n => `
      <div class="note-card">
        <div class="note-card-header">
          <span class="ticket-id-badge">#${esc(n.ticketId)}</span>
          ${n.url
            ? `<a href="${esc(n.url)}" target="_blank" class="note-card-title">${esc(n.title)}</a>`
            : `<span class="note-card-title">${esc(n.title)}</span>`
          }
          <button class="btn-small note-delete-btn" data-id="${esc(n.ticketId)}"
            style="margin-left:auto;background:#fee2e2;color:#991b1b;">🗑 Delete</button>
        </div>
        <div class="note-card-text">${esc(n.text)}</div>
        <div class="note-card-ts">${n.updatedAt
          ? "Saved: " + new Date(n.updatedAt).toLocaleString()
          : ""}</div>
      </div>`).join("");

    list.querySelectorAll(".note-delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("Delete note for ticket #" + id + "?")) return;
        await fetch("/personal-notes/" + id, { method: "DELETE" }).catch(() => {});
        showStatus("Note deleted.");
        loadAllNotes();
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="empty-state">Could not load notes: ${e.message}</div>`;
  }
}

// ─── Bulk summaries tab ───────────────────────────────────────────────────────
let bulkPollTimer = null;

document.getElementById("refreshBulkBtn").addEventListener("click", () => {
  stopBulkPoll(); loadBulkSummaries();
});

function startBulkPoll() {
  stopBulkPoll();
  bulkPollTimer = setInterval(loadBulkSummaries, 3000);
}

function stopBulkPoll() {
  if (bulkPollTimer) { clearInterval(bulkPollTimer); bulkPollTimer = null; }
}

async function loadBulkSummaries() {
  try {
    const r    = await fetch("/bulk-summaries");
    const data = await r.json();
    renderBulkList(data.results || []);
  } catch (e) {
    document.getElementById("bulk-list").innerHTML =
      `<div class="empty-state">Could not reach server: ${e.message}</div>`;
  }
}

function renderBulkList(results) {
  const list = document.getElementById("bulk-list");
  if (!results.length) {
    list.innerHTML = `<div class="empty-state">
      Waiting for results… Use the extension popup → <strong>Bulk Summarize All</strong>.
    </div>`;
    return;
  }
  list.innerHTML = results.map(r => {
    const isError = r.summary && r.summary.startsWith("Could not summarize");
    return `<div class="bulk-card ${isError ? "bulk-card-error" : ""}">
      <div class="bulk-card-header">
        <span class="ticket-id-badge">#${esc(r.ticketId)}</span>
        <strong>${esc(r.title)}</strong>
        ${isError ? '<span class="error-badge">⚠️ Failed</span>' : ""}
      </div>
      <div class="bulk-summary">${markdownLite(r.summary)}</div>
    </div>`;
  }).join("");
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function buildNotesText(notes) {
  return (notes || []).map(n =>
    `[Note ${n.noteNumber} by ${n.author}${n.date ? " on " + n.date : ""}]:\n${n.content}`
  ).join("\n\n");
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

function markdownLite(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^#{1,3}\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/\n/g, "<br>");
}

function showEl(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hideEl(id) { document.getElementById(id)?.classList.add("hidden"); }

function showStatus(msg, isErr = false) {
  const el = document.createElement("div");
  el.className   = "toast " + (isErr ? "toast-err" : "toast-ok");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── Auto-load on open ────────────────────────────────────────────────────────
(async () => {
  try {
    latestData = await fetchLatest();
    renderTicketHeader();
    renderTimeEstimate(latestData);
    loadPersonalNote(latestData.ticketId);
    loadAssigneeSnapshot(latestData.assignee);
    if (latestData.ticketId && summaryCache[latestData.ticketId]) {
      lastSummary = summaryCache[latestData.ticketId];
      renderAiOutput("🧠 AI Summary (cached)", lastSummary);
    }
  } catch (_) {}

  setInterval(async () => {
    if (activeTab !== "single") return;
    try {
      const fresh = await fetchLatest();
      if (fresh.timestamp !== latestData?.timestamp) {
        latestData = fresh;
        renderTicketHeader();
        renderTimeEstimate(latestData);
        loadAssigneeSnapshot(latestData.assignee);
      }
    } catch (_) {}
  }, 5000);

  if (window.location.hash === "#bulk") {
    document.querySelector("[data-tab='bulk']").click();
    history.replaceState(null, "", "/");
  }
})();
