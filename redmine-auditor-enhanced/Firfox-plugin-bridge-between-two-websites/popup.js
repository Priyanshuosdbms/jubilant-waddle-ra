console.log("Popup loaded");

const STATUS_TIMEOUT = 3000;

function setStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.style.color = isError ? "#cc0000" : "#4a4";
  el.textContent = msg;
  setTimeout(() => { el.textContent = ""; }, STATUS_TIMEOUT);
}

// ─── Storage helpers ─────────────────────────────────────────────────────────
function getTickets(cb) {
  chrome.storage.local.get(["savedTickets"], (result) => {
    cb(result.savedTickets || []);
  });
}

function saveTickets(tickets, cb) {
  chrome.storage.local.set({ savedTickets: tickets }, cb);
}

// ─── Render ticket list ───────────────────────────────────────────────────────
function renderTickets() {
  getTickets(tickets => {
    const list  = document.getElementById("tickets-list");
    const empty = document.getElementById("empty-msg");
    const count = document.getElementById("ticket-count");

    count.textContent = tickets.length;

    if (!tickets.length) {
      list.innerHTML = "";
      list.appendChild(empty);
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    list.innerHTML = "";

    tickets.forEach((ticket, idx) => {
      const item = document.createElement("div");
      item.className = "ticket-item";
      const ts = ticket.timestamp
        ? new Date(ticket.timestamp).toLocaleDateString()
        : "";
      item.innerHTML = `
        <div class="ticket-info">
          <div class="ticket-id">#${ticket.ticketId}</div>
          <div class="ticket-title" title="${escHtml(ticket.title)}">${escHtml(ticket.title)}</div>
          <div class="ticket-ts">${ts}</div>
        </div>
        <div class="actions-row">
          <button class="small blue open-btn" data-url="${escHtml(ticket.url)}">Open</button>
          <button class="danger delete-btn" data-idx="${idx}">✕</button>
        </div>
      `;
      list.appendChild(item);
    });

    // Open button
    list.querySelectorAll(".open-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        chrome.tabs.create({ url: btn.dataset.url });
      });
    });

    // Delete button — never auto-deletes; user must click
    list.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx, 10);
        getTickets(tickets => {
          tickets.splice(idx, 1);
          saveTickets(tickets, renderTickets);
          setStatus("Ticket removed from queue.");
        });
      });
    });
  });
}

function escHtml(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── Launch split screen ──────────────────────────────────────────────────────
document.getElementById("openSplitBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length) { setStatus("No active tab.", true); return; }
    chrome.tabs.sendMessage(tabs[0].id, { action: "splitScreen" }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus("Error: " + chrome.runtime.lastError.message, true);
      } else {
        setStatus("Split screen launched!");
      }
    });
  });
});

// ─── Add current ticket to queue ──────────────────────────────────────────────
document.getElementById("addTicketBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length) { setStatus("No active tab.", true); return; }
    chrome.tabs.sendMessage(tabs[0].id, { action: "extractData" }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        setStatus("Could not extract ticket data. Are you on a Redmine page?", true);
        return;
      }
      const payload = response.payload;
      getTickets(tickets => {
        // Avoid duplicate by ticketId
        const exists = tickets.some(t => t.ticketId === payload.ticketId);
        if (exists) {
          setStatus("Ticket already in queue!", true);
          return;
        }
        tickets.push(payload);
        saveTickets(tickets, () => {
          renderTickets();
          setStatus(`#${payload.ticketId} added to queue!`);
        });
      });
    });
  });
});

// ─── Bulk summarize ───────────────────────────────────────────────────────────
document.getElementById("bulkSummarizeBtn").addEventListener("click", () => {
  getTickets(tickets => {
    if (!tickets.length) {
      setStatus("Queue is empty.", true);
      return;
    }
    const btn = document.getElementById("bulkSummarizeBtn");
    btn.textContent = "⏳ Summarizing…";
    btn.disabled = true;

    chrome.runtime.sendMessage(
      { action: "bulkSummarize", tickets },
      (response) => {
        btn.textContent = "📋 Bulk Summarize All";
        btn.disabled = false;
        if (response && response.success) {
          // Send results to localhost app
          fetch("http://localhost:3000/bulk-summaries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ results: response.results })
          }).catch(() => {});
          // Open the app
          chrome.tabs.create({ url: "http://localhost:3000/#bulk" });
          setStatus("Bulk summaries ready!");
        } else {
          setStatus("Bulk summarize failed: " + (response?.error || "?"), true);
        }
      }
    );
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", renderTickets);
renderTickets();
