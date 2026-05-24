console.log("Background script started");

// All LLM calls go through the Express server proxy at localhost:3000/api/llm.
// Direct fetch to localhost:11434 from a Firefox extension background script
// is blocked regardless of manifest permissions — proven from previous debugging.
const PROXY_URL = "http://localhost:3000/api/llm";

// ─── LLM helper ──────────────────────────────────────────────────────────────
async function callLLM(systemPrompt, userContent, maxTokens = 1024) {
  const response = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, userContent, maxTokens })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Proxy error ${response.status}: ${err}`);
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.error || "LLM returned no result");
  return data.text || "";
}

// ─── Message listener ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received:", message.action);

  // --- POST ticket data to localhost app ---
  if (message.action === "sendToLocalhost") {
    fetch("http://localhost:3000/redmine-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload)
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

  // --- AI Summarize (single ticket) ---
  if (message.action === "summarize") {
    const { ticketData } = message;
    const notesText = (ticketData.notes || [])
      .map(n => `[Note ${n.noteNumber} by ${n.author}${n.date ? " on " + n.date : ""}]:\n${n.content}`)
      .join("\n\n");

    const system = `You are a Redmine ticket analyst. Given a ticket, produce:
1. A concise summary of the full ticket.
2. A task-completion analysis: list each proposed task/requirement, whether it was completed, on what date (if mentioned), and if pending - the reason if any.
3. A final one-line scorecard like: "X of Y tasks completed. Z pending."
Format with clear sections.`;

    const user = `Ticket: ${ticketData.title}
URL: ${ticketData.url}
Description:\n${ticketData.description}
History/Notes:\n${notesText || "None"}`;

    callLLM(system, user, 1200)
      .then(text => sendResponse({ success: true, summary: text }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

  // --- AI Edit Review ---
  if (message.action === "reviewEdit") {
    const { ticketData, newEditText } = message;
    const notesText = (ticketData.notes || [])
      .map(n => `[Note ${n.noteNumber} by ${n.author}]:\n${n.content}`)
      .join("\n\n");

    const system = `You are a Redmine ticket reviewer. Given the original ticket description, its history, and a new proposed update, provide:
1. How well the update aligns with the original ticket goals.
2. What new information or progress it adds compared to the history.
3. Any concerns, gaps, or suggestions for improvement.
4. A quality rating: Excellent / Good / Needs Improvement.
Be concise and constructive.`;

    const user = `Original Ticket: ${ticketData.title}
Description:\n${ticketData.description}
Previous History:\n${notesText || "None"}

--- Proposed Update ---
${newEditText}`;

    callLLM(system, user, 900)
      .then(text => sendResponse({ success: true, review: text }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

  // --- Polish draft reply ---
  if (message.action === "polishDraft") {
    const { ticketData, draft } = message;

    const system = `You are a professional technical writer helping a developer write clear Redmine ticket updates.
Rewrite the user's rough draft into a concise, professional update note.
Preserve all facts and intent. Improve clarity, grammar and structure.
Output ONLY the rewritten update text — no preamble, no explanation.`;

    const user = `Ticket context: ${ticketData.title}
Description: ${ticketData.description}

User's rough draft:
${draft}`;

    callLLM(system, user, 600)
      .then(text => sendResponse({ success: true, polished: text }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

  // --- Bulk summarize: sequential, one ticket at a time ---
  if (message.action === "bulkSummarize") {
    const { tickets } = message;

    (async () => {
      const results = [];

      for (const ticket of tickets) {
        const notesText = (ticket.notes || [])
          .map(n => `[${n.author}]: ${n.content}`)
          .join("\n");

        const system = `You are a concise Redmine ticket summarizer. Summarize in 3-5 sentences. Then add one line: "Tasks: X completed, Y pending."`;
        const user   = `Ticket: ${ticket.title}\nDescription: ${ticket.description}\nNotes: ${notesText || "None"}`;

        let summary;
        try {
          summary = await Promise.race([
            callLLM(system, user, 400),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Timed out after 90s")), 90000)
            )
          ]);
        } catch (err) {
          summary = `Could not summarize: ${err.message}`;
        }

        const result = { ticketId: ticket.ticketId, title: ticket.title, summary };
        results.push(result);

        // Stream result to server immediately for live UI update
        try {
          await fetch("http://localhost:3000/bulk-summary-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result)
          });
        } catch (_) { /* server not running; non-fatal */ }
      }

      sendResponse({ success: true, results });
    })();

    return true;
  }
});
