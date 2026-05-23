console.log("Redmine Auditor content script loaded");

let alreadySplit = false;

// ─── Message listener ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content received:", message.action);

  if (message.action === "splitScreen") {
    if (alreadySplit) {
      sendResponse({ success: true, alreadySplit: true });
      return true;
    }
    alreadySplit = true;
    createSplitScreen();
    transferRedmineData();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "extractData") {
    const payload = extractRedmineData();
    sendResponse({ success: true, payload });
    return true;
  }

  if (message.action === "getEditContent") {
    const editContent = extractEditContent();
    sendResponse({ success: true, editContent });
    return true;
  }

  return true;
});

// ─── Split Screen ────────────────────────────────────────────────────────────
function createSplitScreen() {
  console.log("Creating split screen");
  const bodyChildren = Array.from(document.body.children);
  const wrapper  = document.createElement("div");
  wrapper.id = "redmine-extension-wrapper";

  const leftPane = document.createElement("div");
  leftPane.id = "redmine-left-pane";

  const rightPane = document.createElement("div");
  rightPane.id = "redmine-right-pane";

  const iframe = document.createElement("iframe");
  iframe.src = "http://localhost:3000";
  iframe.id  = "redmine-assistant-iframe";
  iframe.onload = () => console.log("Iframe loaded");
  rightPane.appendChild(iframe);

  bodyChildren.forEach(child => {
    if (child.id !== "redmine-extension-wrapper") {
      leftPane.appendChild(child);
    }
  });

  wrapper.appendChild(leftPane);
  wrapper.appendChild(rightPane);
  document.body.appendChild(wrapper);

  injectSummarizeButton(leftPane);
  detectEditMode(leftPane);

  console.log("Split screen created");
}

// ─── Inject floating Summarize button ────────────────────────────────────────
function injectSummarizeButton(container) {
  const btn = document.createElement("button");
  btn.id        = "ra-summarize-btn";
  btn.innerText = "🧠 AI Summarize";
  btn.title     = "Summarize this ticket using AI";
  btn.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: calc(50% - 80px);
    z-index: 10000000;
    background: #cc0000;
    color: white;
    border: none;
    border-radius: 24px;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  btn.addEventListener("click", () => {
    const payload = extractRedmineData();
    btn.innerText  = "⏳ Summarizing…";
    btn.disabled   = true;
    chrome.runtime.sendMessage(
      { action: "summarize", ticketData: payload },
      (response) => {
        btn.innerText = "🧠 AI Summarize";
        btn.disabled  = false;
        if (response && response.success) {
          postToAssistant({ action: "showSummary", summary: response.summary, ticketData: payload });
        } else {
          alert("Summarization failed: " + (response?.error || "Unknown error"));
        }
      }
    );
  });
  document.body.appendChild(btn);
}

// ─── Detect edit mode and inject Review button ────────────────────────────────
function detectEditMode(container) {
  // Observe for the edit form appearing (Redmine loads edit forms dynamically)
  const observer = new MutationObserver(() => {
    const editForm = document.querySelector("#issue-form, form.edit_issue, #update");
    if (editForm && !document.getElementById("ra-review-btn")) {
      injectReviewButton(editForm);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Also check immediately in case already in edit mode
  const editForm = document.querySelector("#issue-form, form.edit_issue, #update");
  if (editForm) injectReviewButton(editForm);
}

function injectReviewButton(editForm) {
  const btn = document.createElement("button");
  btn.id        = "ra-review-btn";
  btn.type      = "button";
  btn.innerText = "🔍 AI Review Update";
  btn.title     = "Get AI review of your edit based on ticket history";
  btn.style.cssText = `
    margin: 8px 4px;
    background: #0055cc;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: bold;
    cursor: pointer;
  `;
  btn.addEventListener("click", () => {
    const editContent = extractEditContent();
    if (!editContent || editContent.trim().length < 5) {
      alert("Please enter some update text first.");
      return;
    }
    const ticketData = extractRedmineData();
    btn.innerText = "⏳ Reviewing…";
    btn.disabled  = true;
    chrome.runtime.sendMessage(
      { action: "reviewEdit", ticketData, newEditText: editContent },
      (response) => {
        btn.innerText = "🔍 AI Review Update";
        btn.disabled  = false;
        if (response && response.success) {
          postToAssistant({ action: "showReview", review: response.review });
        } else {
          alert("Review failed: " + (response?.error || "Unknown error"));
        }
      }
    );
  });

  // Insert before the submit button or at the end of the form
  const submitBtn = editForm.querySelector("input[type=submit], button[type=submit]");
  if (submitBtn) {
    editForm.insertBefore(btn, submitBtn);
  } else {
    editForm.appendChild(btn);
  }
}

// ─── Post message to iframe (localhost:3000) ─────────────────────────────────
function postToAssistant(data) {
  const iframe = document.getElementById("redmine-assistant-iframe");
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage(data, "http://localhost:3000");
  }
}

// ─── Extract current ticket data ──────────────────────────────────────────────
function extractRedmineData() {
  const title = document.querySelector(".subject h3")?.innerText
    || document.querySelector("h2.issue")?.innerText
    || document.title
    || "No title found";

  let description = document.querySelector(".description .wiki")?.innerText
    || document.querySelector(".description")?.innerText
    || "No description found";
  description = description.replace(/^Description\s*/i, "").trim();

  const notesElements = document.querySelectorAll(".journal");
  const notes = [];
  notesElements.forEach((note, index) => {
    const author  = note.querySelector(".user")?.innerText || "Unknown User";
    const dateEl  = note.querySelector(".timestamp, abbr.timestamp, .created-at");
    const date    = dateEl?.innerText || dateEl?.title || "";
    const content = note.querySelector(".wiki")?.innerText || note.innerText;
    notes.push({ noteNumber: index + 1, author, date, content });
  });

  // Extract ticket ID from URL
  const urlMatch = window.location.href.match(/\/issues\/(\d+)/);
  const ticketId = urlMatch ? urlMatch[1] : Date.now().toString();

  return {
    ticketId,
    title,
    description,
    notes,
    url: window.location.href,
    timestamp: new Date().toISOString()
  };
}

// ─── Extract edit/update textarea content ─────────────────────────────────────
function extractEditContent() {
  // Redmine edit textarea for notes/updates
  const textarea = document.querySelector(
    "#issue_notes, textarea[name='issue[notes]'], #notes, textarea.wiki-edit"
  );
  if (textarea) return textarea.value;

  // Also check description edit field
  const descEdit = document.querySelector(
    "#issue_description, textarea[name='issue[description]']"
  );
  if (descEdit) return descEdit.value;

  return "";
}

// ─── Transfer data to localhost on load ───────────────────────────────────────
function transferRedmineData() {
  try {
    const payload = extractRedmineData();
    console.log("Transferring Redmine data:", payload.title);
    chrome.runtime.sendMessage(
      { action: "sendToLocalhost", payload },
      (response) => console.log("Background response:", response)
    );
  } catch (error) {
    console.error("Failed extracting Redmine data:", error);
  }
}
