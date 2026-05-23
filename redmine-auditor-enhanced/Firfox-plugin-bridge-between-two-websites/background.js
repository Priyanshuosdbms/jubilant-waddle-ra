console.log("Background script started");

const VLLM_URL = "http://localhost:8000/v1/chat/completions";
const VLLM_MODEL = "Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4";

// ─── vLLM helper ───────────────────────────────────────────────────────────
async function callVLLM(systemPrompt, userContent, maxTokens = 1024) {
  const response = await fetch(VLLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VLLM_MODEL,
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
    throw new Error(`vLLM error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ─── Message listener ───────────────────────────────────────────────────────
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

  // --- AI Summarize ---
  if (message.action === "summarize") {
    const { ticketData } = message;
    const notesText = (ticketData.notes || [])
      .map(n => `[Note ${n.noteNumber} by ${n.author}]:\n${n.content}`)
      .join("\n\n");

    const system = `You are a Redmine ticket analyst. Given a ticket, produce:
1. A concise summary of the full ticket.
2. A task-completion analysis: list each proposed task/requirement, whether it was completed, on what date (if mentioned), and if pending – the reason if any.
3. A final one-line scorecard like: "X of Y tasks completed. Z pending."
Format with clear sections.`;

    const user = `Ticket: ${ticketData.title}
URL: ${ticketData.url}
Description:\n${ticketData.description}
History/Notes:\n${notesText || "None"}`;

    callVLLM(system, user, 1200)
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

    callVLLM(system, user, 900)
      .then(text => sendResponse({ success: true, review: text }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

  // --- Multi-ticket: bulk summarize all saved tickets ---
  if (message.action === "bulkSummarize") {
    const { tickets } = message;
    const promises = tickets.map(ticket => {
      const notesText = (ticket.notes || [])
        .map(n => `[${n.author}]: ${n.content}`)
        .join("\n");
      const system = `You are a concise Redmine ticket summarizer. Summarize in 3-5 sentences. Then add one line: "Tasks: X completed, Y pending."`;
      const user  = `Ticket: ${ticket.title}\nDescription: ${ticket.description}\nNotes: ${notesText}`;
      return callVLLM(system, user, 400)
        .then(summary => ({ ticketId: ticket.ticketId, title: ticket.title, summary }))
        .catch(err => ({ ticketId: ticket.ticketId, title: ticket.title, summary: `Error: ${err.message}` }));
    });
    Promise.all(promises)
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }
});
