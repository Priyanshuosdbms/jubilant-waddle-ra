// ─── State ────────────────────────────────────────────────────────────────────
let latestData       = null;
let lastSummary      = "";   // persist summary while user navigates
let lastReview       = "";
let activeTab        = "single";
const summaryCache   = {};   // ticketId -> summary text

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + tab).classList.add("active");
    activeTab = tab;
    if (tab === "bulk") loadBulkSummaries();
  });
});

// ─── postMessage from extension content.js ────────────────────────────────────
window.addEventListener("message", (event) => {
  if (!event.data || !event.data.action) return;

  if (event.data.action === "showSummary") {
    lastSummary = event.data.summary;
    if (event.data.ticketData) latestData = event.data.ticketData;
    renderAiOutput("🧠 AI Summary", lastSummary);
    // Switch to single tab if not already there
    document.getElementById("showSingleBtn").click();
  }

  if (event.data.action === "showReview") {
    lastReview = event.data.review;
    renderReview(lastReview);
    document.getElementById("showSingleBtn").click();
  }
});

// ─── Fetch helpers ────────────────────────────────────────────────────────────
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

// ─── Load ticket ──────────────────────────────────────────────────────────────
document.getElementById("loadBtn").addEventListener("click", loadTicket);

async function loadTicket() {
  try {
    latestData = await fetchLatest();
    renderTicketHeader();
    // Restore last summary if same ticket
    if (lastSummary) {
      renderAiOutput("🧠 AI Summary", lastSummary);
    } else {
      hideEl("ai-output");
    }
    hideEl("review-panel");
    document.getElementById("contentArea").innerHTML = "";
    showStatus("Ticket loaded.");
  } catch (e) {
    showStatus("Could not load ticket: " + e.message, true);
  }
}

function renderTicketHeader() {
  if (!latestData) return;
  const hdr = document.getElementById("ticket-header");
  document.getElementById("ticket-title").textContent = latestData.title || "Untitled";
  const link = document.getElementById("ticket-url");
  link.href        = latestData.url || "#";
  link.textContent = latestData.url || "";
  hdr.classList.remove("hidden");
}

// ─── AI Summarize ─────────────────────────────────────────────────────────────
document.getElementById("summarizeBtn").addEventListener("click", async () => {
  if (!latestData) { latestData = await fetchLatest().catch(() => null); }
  if (!latestData || !latestData.title) {
    showStatus("No ticket data. Click Load first.", true); return;
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
    const user = `Ticket: ${latestData.title}\nURL: ${latestData.url}\n\nDescription:\n${latestData.description}\n\nHistory:\n${notesText || "None"}`;
    const summary = await callLLM(system, user, 1200);
    lastSummary = summary;
    // Cache by ticketId
    if (latestData.ticketId) summaryCache[latestData.ticketId] = summary;
    renderAiOutput("🧠 AI Summary", summary);
  } catch (e) {
    showStatus("Summarize failed: " + e.message, true);
  } finally {
    btn.textContent = "🧠 AI Summarize";
    btn.disabled    = false;
  }
});

// ─── Show Details (old Evaluate) ─────────────────────────────────────────────
document.getElementById("evaluateBtn").addEventListener("click", async () => {
  if (!latestData) { latestData = await fetchLatest().catch(() => null); }
  if (!latestData) { showStatus("No data loaded.", true); return; }

  const contentArea = document.getElementById("contentArea");
  let notesHTML = "";
  if (latestData.notes && latestData.notes.length) {
    latestData.notes.forEach(note => {
      notesHTML += `<div class="note">
        <div class="note-meta"><strong>${esc(note.author)}</strong> ${note.date ? "· " + esc(note.date) : ""}</div>
        <div class="note-content">${esc(note.content)}</div>
      </div>`;
    });
  } else {
    notesHTML = "<em>No notes.</em>";
  }

  contentArea.innerHTML = `
    <div class="card">
      <h2>Description</h2>
      <div class="description-text">${esc(latestData.description)}</div>
    </div>
    <div class="card">
      <h2>History / Notes</h2>
      ${notesHTML}
    </div>
  `;
});

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderAiOutput(label, text) {
  document.getElementById("ai-output-label").textContent = label;
  document.getElementById("ai-output-body").innerHTML = markdownLite(text);
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

// ─── Bulk summaries tab ───────────────────────────────────────────────────────
document.getElementById("refreshBulkBtn").addEventListener("click", loadBulkSummaries);

async function loadBulkSummaries() {
  try {
    const r = await fetch("/bulk-summaries");
    const data = await r.json();
    renderBulkList(data.results || []);
  } catch (e) {
    document.getElementById("bulk-list").innerHTML =
      `<div class="empty-state">Error loading: ${e.message}</div>`;
  }
}

function renderBulkList(results) {
  const list = document.getElementById("bulk-list");
  if (!results.length) {
    list.innerHTML = `<div class="empty-state">No bulk summaries yet. Use the extension popup to run Bulk Summarize All.</div>`;
    return;
  }
  list.innerHTML = results.map(r => `
    <div class="bulk-card">
      <div class="bulk-card-header">
        <span class="ticket-id-badge">#${esc(r.ticketId)}</span>
        <strong>${esc(r.title)}</strong>
      </div>
      <div class="bulk-summary">${markdownLite(r.summary)}</div>
    </div>
  `).join("");
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function buildNotesText(notes) {
  return (notes || []).map(n =>
    `[Note ${n.noteNumber} by ${n.author}${n.date ? " on " + n.date : ""}]:\n${n.content}`
  ).join("\n\n");
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/** Very lightweight markdown: bold, bullet lists, newlines */
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

function showEl(id)  { document.getElementById(id).classList.remove("hidden"); }
function hideEl(id)  { document.getElementById(id).classList.add("hidden"); }

function showStatus(msg, isErr = false) {
  // Use the ticket header area as a toast
  const el = document.createElement("div");
  el.className  = "toast " + (isErr ? "toast-err" : "toast-ok");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── Auto-load on open ────────────────────────────────────────────────────────
(async () => {
  try {
    latestData = await fetchLatest();
    renderTicketHeader();
    // Restore cached summary for this ticket
    if (latestData.ticketId && summaryCache[latestData.ticketId]) {
      lastSummary = summaryCache[latestData.ticketId];
      renderAiOutput("🧠 AI Summary (cached)", lastSummary);
    }
  } catch (_) {}

  // Auto-refresh every 5 seconds
  setInterval(async () => {
    if (activeTab !== "single") return;
    try {
      const fresh = await fetchLatest();
      if (fresh.timestamp !== latestData?.timestamp) {
        latestData = fresh;
        renderTicketHeader();
      }
    } catch (_) {}
  }, 5000);

  // Handle #bulk hash from popup
  if (window.location.hash === "#bulk") {
    document.getElementById("showBulkBtn").click();
    history.replaceState(null, "", "/");
  }
})();
