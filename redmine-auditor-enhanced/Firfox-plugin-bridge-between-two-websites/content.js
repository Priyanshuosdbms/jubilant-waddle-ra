console.log("Redmine Auditor content script loaded");

let alreadySplit = false;
let isMinimized  = false;
let iframeReady  = false;   // true once iframe fires onload
const pendingMessages = []; // queued postMessage calls before iframe is ready

const SS_ACTIVE_KEY = "ra_split_active";
const SS_MIN_KEY    = "ra_split_minimized";
const SS_LEFT_W_KEY = "ra_split_left_width";

// ─── Auto-restore split screen after navigation ───────────────────────────────
(function autoRestore() {
  if (sessionStorage.getItem(SS_ACTIVE_KEY) !== "1") return;
  setTimeout(() => {
    if (alreadySplit) return;
    alreadySplit = true;
    const savedMin = sessionStorage.getItem(SS_MIN_KEY) === "1";
    createSplitScreen(savedMin);
    if (/\/issues\/\d+/.test(window.location.href)) {
      transferRedmineData();
    }
  }, 150);
})();

// ─── Message listener (from popup) ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content received:", message.action);

  if (message.action === "splitScreen") {
    if (alreadySplit) {
      // If minimized, restore it
      if (isMinimized) {
        const minBtn = document.getElementById("ra-minimize-btn");
        if (minBtn) minBtn.click();
      }
      sendResponse({ success: true, alreadySplit: true });
      return true;
    }
    alreadySplit = true;
    sessionStorage.setItem(SS_ACTIVE_KEY, "1");
    sessionStorage.removeItem(SS_MIN_KEY);
    createSplitScreen(false);
    transferRedmineData();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "extractData") {
    sendResponse({ success: true, payload: extractRedmineData() });
    return true;
  }

  if (message.action === "getEditContent") {
    sendResponse({ success: true, editContent: extractEditContent() });
    return true;
  }

  return true;
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  // Alt+S: open split (if needed) then summarize
  if (e.altKey && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    triggerSummarizeFlow();
  }
  // Alt+M: toggle minimize
  if (e.altKey && (e.key === "m" || e.key === "M")) {
    e.preventDefault();
    const minBtn = document.getElementById("ra-minimize-btn");
    if (minBtn) minBtn.click();
  }
});

// ─── Create split screen ──────────────────────────────────────────────────────
function createSplitScreen(startMinimized) {
  console.log("Creating split screen, minimized:", startMinimized);

  const bodyChildren = Array.from(document.body.children);

  const wrapper   = document.createElement("div");
  wrapper.id      = "redmine-extension-wrapper";

  const leftPane  = document.createElement("div");
  leftPane.id     = "redmine-left-pane";

  const divider   = document.createElement("div");
  divider.id      = "ra-divider";
  divider.title   = "Drag to resize";

  const rightPane = document.createElement("div");
  rightPane.id    = "redmine-right-pane";

  const controlBar = buildControlBar(wrapper, leftPane, divider, rightPane);
  rightPane.appendChild(controlBar);

  const iframe  = document.createElement("iframe");
  iframe.src    = "http://localhost:3000";
  iframe.id     = "redmine-assistant-iframe";
  iframe.onload = () => {
    iframeReady = true;
    console.log("Iframe loaded — flushing", pendingMessages.length, "queued messages");
    pendingMessages.forEach(msg => sendToIframe(msg));
    pendingMessages.length = 0;
  };
  rightPane.appendChild(iframe);

  bodyChildren.forEach(child => {
    if (child.id !== "redmine-extension-wrapper") leftPane.appendChild(child);
  });

  wrapper.appendChild(leftPane);
  wrapper.appendChild(divider);
  wrapper.appendChild(rightPane);
  document.body.appendChild(wrapper);

  // Restore saved pane width
  const savedW = sessionStorage.getItem(SS_LEFT_W_KEY);
  if (savedW) {
    leftPane.style.width  = savedW + "%";
    rightPane.style.width = (100 - parseFloat(savedW)) + "%";
  }

  initResizableDivider(wrapper, leftPane, divider, rightPane);
  injectLogoButton();   // floating logo pill at bottom-left
  detectEditMode();

  if (startMinimized) {
    applyMinimized(wrapper, leftPane, divider, rightPane, true, false);
  }

  console.log("Split screen created");
}

// ─── postToAssistant: queues if iframe not ready yet ─────────────────────────
function postToAssistant(data) {
  if (iframeReady) {
    sendToIframe(data);
  } else {
    console.log("Iframe not ready — queuing message:", data.action);
    pendingMessages.push(data);
  }
}

function sendToIframe(data) {
  const iframe = document.getElementById("redmine-assistant-iframe");
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage(data, "http://localhost:3000");
  }
}

// ─── Control bar ─────────────────────────────────────────────────────────────
function buildControlBar(wrapper, leftPane, divider, rightPane) {
  const bar = document.createElement("div");
  bar.id = "ra-control-bar";

  const info = document.createElement("div");
  info.id = "ra-control-info";

  const logo = document.createElement("span");
  logo.id          = "ra-control-logo";
  logo.textContent = "🔴 Redmine Auditor";

  const pageCtx = document.createElement("span");
  pageCtx.id = "ra-control-page";
  updatePageContext(pageCtx);

  info.appendChild(logo);
  info.appendChild(pageCtx);

  const actions = document.createElement("div");
  actions.id = "ra-control-actions";

  const minBtn = document.createElement("button");
  minBtn.id          = "ra-minimize-btn";
  minBtn.textContent = "⬛ Minimize";
  minBtn.title       = "Collapse the assistant panel (Alt+M)";
  minBtn.addEventListener("click", () => {
    isMinimized = !isMinimized;
    applyMinimized(wrapper, leftPane, divider, rightPane, isMinimized, true);
  });

  const closeBtn = document.createElement("button");
  closeBtn.id          = "ra-close-btn";
  closeBtn.textContent = "✕ Close";
  closeBtn.title       = "Close assistant and return to normal browsing";
  closeBtn.addEventListener("click", () => closeSplitScreen(wrapper, leftPane));

  actions.appendChild(minBtn);
  actions.appendChild(closeBtn);
  bar.appendChild(info);
  bar.appendChild(actions);
  return bar;
}

function updatePageContext(el) {
  const url   = window.location.href;
  const match = url.match(/\/issues\/(\d+)/);
  if (match) {
    el.textContent = "Ticket #" + match[1];
    el.className   = "ra-ctx-ticket";
  } else if (/\/projects\/[^/]+\/?$/.test(url)) {
    el.textContent = "Project overview";
    el.className   = "ra-ctx-other";
  } else {
    el.textContent = "Non-ticket page";
    el.className   = "ra-ctx-other";
  }
}

// ─── Minimize / restore ───────────────────────────────────────────────────────
// BUG FIX: right pane must keep min-width:40px so the control bar
// is always visible and clickable, even when "collapsed".
function applyMinimized(wrapper, leftPane, divider, rightPane, minimize, persist) {
  isMinimized = minimize;
  const minBtn = document.getElementById("ra-minimize-btn");
  const iframe = document.getElementById("redmine-assistant-iframe");

  if (minimize) {
    leftPane.style.width     = "calc(100% - 40px)";
    divider.style.display    = "none";
    if (iframe) iframe.style.display = "none";
    rightPane.style.width    = "40px";
    rightPane.style.minWidth = "40px";
    rightPane.style.overflow = "hidden";
    if (minBtn) {
      minBtn.textContent = "⬜ Restore";
      minBtn.title       = "Restore assistant panel (Alt+M)";
    }
    if (persist) sessionStorage.setItem(SS_MIN_KEY, "1");
  } else {
    const savedW = sessionStorage.getItem(SS_LEFT_W_KEY) || "55";
    leftPane.style.width     = savedW + "%";
    divider.style.display    = "";
    if (iframe) iframe.style.display = "";
    rightPane.style.width    = (100 - parseFloat(savedW)) + "%";
    rightPane.style.minWidth = "";
    rightPane.style.overflow = "hidden";
    if (minBtn) {
      minBtn.textContent = "⬛ Minimize";
      minBtn.title       = "Collapse the assistant panel (Alt+M)";
    }
    if (persist) sessionStorage.removeItem(SS_MIN_KEY);
  }
}

// ─── Close split screen ───────────────────────────────────────────────────────
function closeSplitScreen(wrapper, leftPane) {
  Array.from(leftPane.children).forEach(child => document.body.appendChild(child));
  wrapper.remove();
  document.getElementById("ra-logo-pill")?.remove();
  document.body.style.overflow  = "";
  document.documentElement.style.overflow = "";
  document.documentElement.style.height   = "";
  document.body.style.height    = "";
  document.body.style.width     = "";
  sessionStorage.removeItem(SS_ACTIVE_KEY);
  sessionStorage.removeItem(SS_MIN_KEY);
  sessionStorage.removeItem(SS_LEFT_W_KEY);
  alreadySplit = false;
  isMinimized  = false;
  iframeReady  = false;
  pendingMessages.length = 0;
  console.log("Split screen closed");
}

// ─── Resizable divider ────────────────────────────────────────────────────────
function initResizableDivider(wrapper, leftPane, divider, rightPane) {
  let dragging = false, startX, startLeftW;

  divider.addEventListener("mousedown", (e) => {
    dragging   = true;
    startX     = e.clientX;
    startLeftW = leftPane.getBoundingClientRect().width;
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
    iframe_overlay(true);
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const totalW   = wrapper.getBoundingClientRect().width;
    let newLeftPct = ((startLeftW + (e.clientX - startX)) / totalW) * 100;
    newLeftPct     = Math.max(25, Math.min(75, newLeftPct));
    leftPane.style.width  = newLeftPct + "%";
    rightPane.style.width = (100 - newLeftPct) + "%";
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor     = "";
    document.body.style.userSelect = "";
    iframe_overlay(false);
    const pct = parseFloat(leftPane.style.width);
    if (!isNaN(pct)) sessionStorage.setItem(SS_LEFT_W_KEY, pct.toFixed(1));
  });
}

function iframe_overlay(on) {
  let el = document.getElementById("ra-iframe-overlay");
  if (on) {
    if (!el) {
      el = document.createElement("div");
      el.id = "ra-iframe-overlay";
      el.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999998;";
      document.body.appendChild(el);
    }
  } else {
    el?.remove();
  }
}

// ─── Floating logo pill (bottom-left) ─────────────────────────────────────────
// Replaces the old floating summarize button.
// Clicking it (or Alt+S): if split not open → open it then summarize.
//                          if split open & minimized → restore then summarize.
//                          if split open & visible → summarize directly.
function injectLogoButton() {
  // Remove old one if it exists
  document.getElementById("ra-logo-pill")?.remove();

  const pill = document.createElement("button");
  pill.id        = "ra-logo-pill";
  pill.innerHTML = "🔴 <span>AI Summarize</span><kbd>Alt+S</kbd>";
  pill.title     = "Open assistant & summarize this ticket (Alt+S)";
  pill.addEventListener("click", triggerSummarizeFlow);
  document.body.appendChild(pill);
}

// ─── Summarize flow ───────────────────────────────────────────────────────────
// Central function used by both logo pill click and Alt+S.
function triggerSummarizeFlow() {
  // If not on a ticket page, tell user
  if (!/\/issues\/\d+/.test(window.location.href)) {
    showFloatAlert("⚠️ Navigate to a Redmine ticket first.");
    return;
  }

  // Step 1: ensure split screen is open and visible
  if (!alreadySplit) {
    alreadySplit = true;
    sessionStorage.setItem(SS_ACTIVE_KEY, "1");
    sessionStorage.removeItem(SS_MIN_KEY);
    createSplitScreen(false);
    transferRedmineData();
    // Step 2 (below) will run after iframe fires onload via pendingMessages
    runSummarize();
    return;
  }

  // If minimized, restore first
  if (isMinimized) {
    const minBtn = document.getElementById("ra-minimize-btn");
    if (minBtn) minBtn.click();
  }

  runSummarize();
}

function runSummarize() {
  const pill = document.getElementById("ra-logo-pill");
  if (pill) {
    pill.innerHTML  = "⏳ <span>Summarizing…</span>";
    pill.disabled   = true;
  }

  const payload = extractRedmineData();

  // Tell iframe to show a loading state immediately
  postToAssistant({ action: "summarizeStarted" });

  chrome.runtime.sendMessage(
    { action: "summarize", ticketData: payload },
    (response) => {
      if (pill) {
        pill.innerHTML = "🔴 <span>AI Summarize</span><kbd>Alt+S</kbd>";
        pill.disabled  = false;
      }
      if (response && response.success) {
        postToAssistant({ action: "showSummary", summary: response.summary, ticketData: payload });
      } else {
        showFloatAlert("Summarization failed: " + (response?.error || "Unknown error"));
        postToAssistant({ action: "summarizeFailed", error: response?.error });
      }
    }
  );
}

// ─── Detect edit mode and inject Polish + Review buttons ─────────────────────
function detectEditMode() {
  const observer = new MutationObserver(() => {
    const editForm = document.querySelector("#issue-form, form.edit_issue, #update");
    if (editForm && !document.getElementById("ra-review-btn")) injectEditButtons(editForm);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const editForm = document.querySelector("#issue-form, form.edit_issue, #update");
  if (editForm) injectEditButtons(editForm);
}

function injectEditButtons(editForm) {
  const polishBtn = document.createElement("button");
  polishBtn.id        = "ra-polish-btn";
  polishBtn.type      = "button";
  polishBtn.innerText = "✍️ Polish my update";
  polishBtn.title     = "Rewrite your draft into a clear, professional note";
  polishBtn.style.cssText =
    "margin:8px 4px;background:#2a7a2a;color:white;border:none;border-radius:6px;" +
    "padding:8px 16px;font-size:13px;font-weight:bold;cursor:pointer;";
  polishBtn.addEventListener("click", () => {
    const draft = extractEditContent();
    if (!draft || draft.trim().length < 5) {
      showFloatAlert("Please write something in the update field first."); return;
    }
    const ticketData = extractRedmineData();
    polishBtn.innerText = "⏳ Polishing…";
    polishBtn.disabled  = true;
    chrome.runtime.sendMessage({ action: "polishDraft", ticketData, draft }, (response) => {
      polishBtn.innerText = "✍️ Polish my update";
      polishBtn.disabled  = false;
      if (response && response.success) {
        postToAssistant({ action: "showPolished", polished: response.polished, draft });
      } else {
        showFloatAlert("Polish failed: " + (response?.error || "Unknown error"));
      }
    });
  });

  const reviewBtn = document.createElement("button");
  reviewBtn.id        = "ra-review-btn";
  reviewBtn.type      = "button";
  reviewBtn.innerText = "🔍 AI Review Update";
  reviewBtn.title     = "Get AI review of your edit based on ticket history";
  reviewBtn.style.cssText =
    "margin:8px 4px;background:#0055cc;color:white;border:none;border-radius:6px;" +
    "padding:8px 16px;font-size:13px;font-weight:bold;cursor:pointer;";
  reviewBtn.addEventListener("click", () => {
    const editContent = extractEditContent();
    if (!editContent || editContent.trim().length < 5) {
      showFloatAlert("Please enter some update text first."); return;
    }
    const ticketData = extractRedmineData();
    reviewBtn.innerText = "⏳ Reviewing…";
    reviewBtn.disabled  = true;
    chrome.runtime.sendMessage({ action: "reviewEdit", ticketData, newEditText: editContent }, (response) => {
      reviewBtn.innerText = "🔍 AI Review Update";
      reviewBtn.disabled  = false;
      if (response && response.success) {
        postToAssistant({ action: "showReview", review: response.review });
      } else {
        showFloatAlert("Review failed: " + (response?.error || "Unknown error"));
      }
    });
  });

  const submitBtn = editForm.querySelector("input[type=submit], button[type=submit]");
  if (submitBtn) {
    editForm.insertBefore(polishBtn, submitBtn);
    editForm.insertBefore(reviewBtn, submitBtn);
  } else {
    editForm.appendChild(polishBtn);
    editForm.appendChild(reviewBtn);
  }
}

// ─── Extract Redmine data ─────────────────────────────────────────────────────
function extractRedmineData() {
  const title = document.querySelector(".subject h3")?.innerText
    || document.querySelector("h2.issue")?.innerText
    || document.title || "No title found";

  let description = document.querySelector(".description .wiki")?.innerText
    || document.querySelector(".description")?.innerText || "No description found";
  description = description.replace(/^Description\s*/i, "").trim();

  const assignee = document.querySelector(
    ".assigned-to .user, td.assigned-to a, .cf_assignee"
  )?.innerText?.trim()
    || document.querySelector("[title='Assigned To'] + td")?.innerText?.trim() || "";

  const assigneeLink = document.querySelector(".assigned-to a, td.assigned-to a");
  const assigneeHref = assigneeLink?.href || "";

  // Try to get the ticket creation date from the DOM
  const createdEl = document.querySelector(".created-on abbr, .created-on time, abbr[title]");
  const createdDate = createdEl?.getAttribute("title") || createdEl?.innerText?.trim() || "";

  const notesElements = document.querySelectorAll(".journal");
  const notes = [];
  notesElements.forEach((note, index) => {
    const author  = note.querySelector(".user")?.innerText?.trim() || "Unknown User";
    const dateEl  = note.querySelector(".timestamp, abbr.timestamp, .created-at, abbr[title]");
    const date    = dateEl?.getAttribute("title") || dateEl?.innerText?.trim() || "";
    const content = note.querySelector(".wiki")?.innerText || note.innerText;

    const statusChanges = [];
    note.querySelectorAll(".details li, .journal-details li").forEach(li => {
      const text = li.innerText.trim();
      if (/status/i.test(text)) statusChanges.push(text);
    });

    notes.push({ noteNumber: index + 1, author, date, content, statusChanges });
  });

  const urlMatch = window.location.href.match(/\/issues\/(\d+)/);
  const ticketId = urlMatch ? urlMatch[1] : Date.now().toString();

  const payload = {
    ticketId, title, description, assignee, assigneeHref,
    createdDate,   // <-- new: real ticket creation date
    notes, url: window.location.href, timestamp: new Date().toISOString()
  };

  if (assignee) {
    fetch("http://localhost:3000/assignee-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignee, assigneeHref, sourceTicketId: ticketId })
    }).catch(() => {});
  }

  return payload;
}

// ─── Extract edit textarea ────────────────────────────────────────────────────
function extractEditContent() {
  return document.querySelector(
    "#issue_notes, textarea[name='issue[notes]'], #notes, textarea.wiki-edit"
  )?.value
  || document.querySelector(
    "#issue_description, textarea[name='issue[description]']"
  )?.value
  || "";
}

// ─── Transfer data to server ──────────────────────────────────────────────────
function transferRedmineData() {
  try {
    const payload = extractRedmineData();
    console.log("Transferring Redmine data:", payload.title);
    chrome.runtime.sendMessage({ action: "sendToLocalhost", payload },
      (response) => console.log("Background response:", response));
  } catch (error) {
    console.error("Failed extracting Redmine data:", error);
  }
}

// ─── Float alert ─────────────────────────────────────────────────────────────
function showFloatAlert(msg) {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;bottom:70px;left:50%;transform:translateX(-50%);" +
    "background:#333;color:white;padding:10px 18px;border-radius:8px;" +
    "font-size:13px;z-index:10000001;box-shadow:0 4px 12px rgba(0,0,0,0.3);";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ─── "Use this" polished text from iframe ────────────────────────────────────
window.addEventListener("message", (event) => {
  if (!event.data || event.data.action !== "fillEditArea") return;
  const textarea = document.querySelector(
    "#issue_notes, textarea[name='issue[notes]'], #notes, textarea.wiki-edit, " +
    "#issue_description, textarea[name='issue[description]']"
  );
  if (textarea) {
    textarea.value = event.data.text || "";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    showFloatAlert("✅ Polished text applied to the edit field.");
  } else {
    showFloatAlert("⚠️ Could not find the edit field — open the edit form first.");
  }
});
