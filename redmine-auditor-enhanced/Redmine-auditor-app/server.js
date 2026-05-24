const express = require("express");
const cors    = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// ─── In-memory state ─────────────────────────────────────────────────────────
let latestData    = { title: "", description: "", notes: [] };
let bulkSummaries = [];
// Personal notes: { [ticketId]: { text: string, updatedAt: string } }
const personalNotes = {};
// Sentiment cache: { [ticketId]: { result: string, updatedAt: string } }
const sentimentCache = {};
// Assignee data: { [assignee]: { ticketCount: number, tickets: [], href: string } }
const assigneeMap = {};

// ─── Ticket data from extension ───────────────────────────────────────────────
app.post("/redmine-data", (req, res) => {
  console.log("Received ticket:", req.body.title);
  latestData = req.body;
  res.json({ success: true });
});

app.get("/latest", (req, res) => {
  res.json(latestData);
});

// ─── Assignee data ────────────────────────────────────────────────────────────
// content.js posts the assignee name + ticket ID whenever a ticket is opened.
// This builds up a picture of how many tickets each assignee has been seen on.
app.post("/assignee-data", (req, res) => {
  const { assignee, assigneeHref, sourceTicketId } = req.body;
  if (!assignee) return res.json({ success: false, error: "No assignee" });

  if (!assigneeMap[assignee]) {
    assigneeMap[assignee] = { ticketCount: 0, tickets: [], href: assigneeHref || "" };
  }
  const entry = assigneeMap[assignee];
  if (!entry.tickets.includes(sourceTicketId)) {
    entry.tickets.push(sourceTicketId);
    entry.ticketCount = entry.tickets.length;
  }
  console.log(`Assignee "${assignee}" seen on ${entry.ticketCount} ticket(s)`);
  res.json({ success: true, ticketCount: entry.ticketCount });
});

app.get("/assignee-data/:assignee", (req, res) => {
  const name = decodeURIComponent(req.params.assignee);
  const data = assigneeMap[name] || { ticketCount: 0, tickets: [], href: "" };
  res.json(data);
});

// ─── Personal notes ───────────────────────────────────────────────────────────
// GET all notes — returns every saved note with ticketId, title, url so the
// "All My Notes" tab can display them with clickable ticket links.
app.get("/personal-notes", (req, res) => {
  const all = Object.entries(personalNotes).map(([ticketId, n]) => ({
    ticketId,
    title:     n.title     || ("Ticket #" + ticketId),
    url:       n.url       || "",
    text:      n.text      || "",
    updatedAt: n.updatedAt || null
  }));
  all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  res.json({ notes: all });
});

app.get("/personal-notes/:ticketId", (req, res) => {
  const { ticketId } = req.params;
  res.json(personalNotes[ticketId] || { text: "", updatedAt: null });
});

// POST now also accepts title + url so the all-notes view has navigation info.
app.post("/personal-notes/:ticketId", (req, res) => {
  const { ticketId } = req.params;
  const { text, title, url } = req.body;
  personalNotes[ticketId] = {
    text:      text  || "",
    title:     title || ("Ticket #" + ticketId),
    url:       url   || "",
    updatedAt: new Date().toISOString()
  };
  console.log("Personal note saved for #" + ticketId + ": " + personalNotes[ticketId].title);
  res.json({ success: true });
});

app.delete("/personal-notes/:ticketId", (req, res) => {
  const { ticketId } = req.params;
  delete personalNotes[ticketId];
  res.json({ success: true });
});

// ─── Sentiment cache ──────────────────────────────────────────────────────────
app.get("/sentiment/:ticketId", (req, res) => {
  const { ticketId } = req.params;
  res.json(sentimentCache[ticketId] || null);
});

app.post("/sentiment/:ticketId", (req, res) => {
  const { ticketId } = req.params;
  sentimentCache[ticketId] = { ...req.body, updatedAt: new Date().toISOString() };
  res.json({ success: true });
});

// ─── Bulk summaries ───────────────────────────────────────────────────────────
app.post("/bulk-summaries", (req, res) => {
  console.log("Received bulk summaries:", req.body.results?.length);
  bulkSummaries = req.body.results || [];
  res.json({ success: true });
});

app.get("/bulk-summaries", (req, res) => {
  res.json({ results: bulkSummaries });
});

app.post("/bulk-summary-item", (req, res) => {
  const item = req.body;
  console.log(`Bulk item received: #${item.ticketId} - ${item.title}`);
  const idx = bulkSummaries.findIndex(r => r.ticketId === item.ticketId);
  if (idx >= 0) {
    bulkSummaries[idx] = item;
  } else {
    bulkSummaries.push(item);
  }
  res.json({ success: true, total: bulkSummaries.length });
});

app.delete("/bulk-summaries", (req, res) => {
  bulkSummaries = [];
  res.json({ success: true });
});

// ─── Ollama proxy (all extension LLM calls routed here) ──────────────────────
app.post("/api/llm", async (req, res) => {
  const { systemPrompt, userContent, maxTokens = 1024 } = req.body;
  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen:0.5b",
        stream: false,
        options: {
          num_predict: maxTokens,
          temperature: 0.3
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userContent  }
        ]
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `Ollama error: ${err}` });
    }
    const data = await response.json();
    const text = data.message?.content?.trim() || "";
    res.json({ success: true, text });
  } catch (err) {
    console.error("Ollama proxy error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(3000, () => {
  console.log("Redmine Auditor server running at http://localhost:3000");
});
