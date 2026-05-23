# Redmine Auditor — v2.0

Firefox extension + localhost assistant for AI-powered Redmine ticket auditing.

## What's New in v2.0

| Feature | Description |
|---|---|
| **AI Summarize button** | Floating button on the left pane calls vLLM Qwen3.5-INT4 to summarize the ticket, task completion counts, pending reasons, and dates. |
| **Edit Review** | While editing a Redmine ticket, a "🔍 AI Review Update" button appears in the edit form. It sends the draft update + full ticket history to the LLM for a quality review. |
| **Multi-ticket queue** | Save multiple tickets from the popup, then run **Bulk Summarize All** to get all summaries at once without opening each ticket. Summaries persist in the app's bulk view. |
| **Old summaries persist** | Summaries are cached in-memory per ticketId. Navigating away and back restores the last summary without a new LLM call. |
| **Manual ticket deletion** | Saved tickets in the queue are never removed automatically. Each has an **✕** button the user must click to remove it. |
| **Auto-update** | Handled via Firefox extension update mechanisms (see below). |

---

## Architecture

```
Firefox Extension (popup, content, background)
        ↓  postMessage / chrome.runtime.sendMessage
Background.js → vLLM at localhost:8000
        ↓  POST /redmine-data
localhost:3000 (Express server)
        ↓  serves
public/index.html + app.js (AI Assistant UI in the right iframe pane)
```

---

## Setup

### 1. Start vLLM with Qwen2.5-7B-Instruct-GPTQ-Int4

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4 \
  --port 8000 \
  --quantization gptq \
  --dtype float16
```

> The model string used internally is `Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4`.
> Adjust `VLLM_MODEL` in `background.js` and `server.js` if your model name differs.

### 2. Start the localhost assistant app

```bash
cd Redmine-auditor-app
npm install
npm start
# → http://localhost:3000
```

### 3. Load the Firefox extension

1. Open Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on**
2. Select `Firfox-plugin-bridge-between-two-websites/manifest.json`

---

## Auto-Update (Feature 3)

Firefox extensions support automatic updates via the `browser_specific_settings.gecko.update_url` field in `manifest.json`. To enable:

1. **Host** your extension files on a web server (e.g. GitHub Releases).
2. Add to `manifest.json`:
```json
"browser_specific_settings": {
  "gecko": {
    "id": "redmine-auditor@yourorg.com",
    "update_url": "https://yourserver.com/redmine-auditor/updates.json"
  }
}
```
3. Create `updates.json` on your server following [Mozilla's update manifest format](https://extensionworkshop.com/documentation/manage/updating-your-extension/).
4. Users install once; Firefox checks for updates automatically.

For development/internal use, you can also use Firefox's **Signed extension** distribution via AMO (addons.mozilla.org) which handles updates natively.

---

## Usage Guide

### Summarize current ticket
1. Navigate to a Redmine issue.
2. Click the **⚡ Launch Split Screen** button in the popup.
3. Click the floating **🧠 AI Summarize** button on the left pane.
4. The right pane (assistant) shows the summary with task completion counts.

### Review an edit
1. Click **Edit** on a Redmine issue to enter edit mode.
2. Type your update in the notes/description field.
3. Click the **🔍 AI Review Update** button that appears near the form.
4. The right pane shows the AI review of your update vs. the ticket history.

### Multi-ticket queue
1. On each Redmine ticket, open the popup and click **➕ Save to Multi-Ticket Queue**.
2. The popup shows all saved tickets with their IDs and titles.
3. Click **📋 Bulk Summarize All** to get summaries for all queued tickets at once.
4. The assistant app's **Bulk Queue** tab shows all results.
5. To remove a ticket from the queue, click its **✕** button (nothing is auto-deleted).

---

## File Map

```
Firfox-plugin-bridge-between-two-websites/
  manifest.json     ← permissions, content script matches
  background.js     ← vLLM calls, message routing
  content.js        ← scrapes ticket data, injects buttons
  popup.html/.js    ← multi-ticket queue UI
  styles.css        ← split screen + injected button styles

Redmine-auditor-app/
  server.js         ← Express: /redmine-data, /api/llm proxy, /bulk-summaries
  public/
    index.html      ← assistant UI tabs
    app.js          ← fetch, AI calls, postMessage receiver, bulk view
    style.css       ← assistant styling
```
