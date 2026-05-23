const express = require("express");
const cors    = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// ─── In-memory state ─────────────────────────────────────────────────────────
let latestData = { title: "", description: "", notes: [] };
let bulkSummaries = [];           // last bulk-summarize results

// ─── Ticket data from extension ──────────────────────────────────────────────
app.post("/redmine-data", (req, res) => {
  console.log("Received Redmine Data:", req.body.title);
  latestData = req.body;
  res.json({ success: true });
});

app.get("/latest", (req, res) => {
  res.json(latestData);
});

// ─── Bulk summaries from extension ───────────────────────────────────────────
app.post("/bulk-summaries", (req, res) => {
  console.log("Received bulk summaries:", req.body.results?.length);
  bulkSummaries = req.body.results || [];
  res.json({ success: true });
});

app.get("/bulk-summaries", (req, res) => {
  res.json({ results: bulkSummaries });
});

// ─── vLLM proxy (allows the browser frontend to call vLLM without CORS issues)
// The extension background.js calls vLLM directly; this is a fallback for the
// in-browser app.js to call if needed.
app.post("/api/llm", async (req, res) => {
  const { systemPrompt, userContent, maxTokens = 1024 } = req.body;
  try {
    const response = await fetch("http://localhost:8000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userContent  }
        ],
        max_tokens: maxTokens,
        temperature: 0.3
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `vLLM error: ${err}` });
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    res.json({ success: true, text });
  } catch (err) {
    console.error("LLM proxy error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(3000, () => {
  console.log("Redmine Auditor server running at http://localhost:3000");
});
