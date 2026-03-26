/**
 * Foji AI — embeddable chat widget
 *
 * Drop a single <script> tag in any webpage:
 *
 *   <script
 *     src="https://widget.foji.ai/widget.js"
 *     data-agent-token="YOUR_AGENT_TOKEN"
 *     async
 *   ></script>
 *
 * Optional attributes:
 *   data-api-url       Override the API base URL (defaults to https://api.foji.ai)
 *   data-position      "right" | "left"  (default: "right")
 *   data-primary-color Hex color for the launcher button  (default: "#FF2D2D")
 *   data-title         Chat header title  (default: "Assistant")
 *   data-placeholder   Input placeholder text
 *
 * The widget is entirely self-contained — no React, no external CSS imports.
 * It injects its own styles into a Shadow DOM to avoid conflicts.
 */

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────────────────────

  const script = document.currentScript;
  const AGENT_TOKEN = script?.getAttribute("data-agent-token") || "";
  const API_URL = (script?.getAttribute("data-api-url") || "https://api.foji.ai").replace(/\/$/, "");
  const POSITION = script?.getAttribute("data-position") || "right";
  const PRIMARY = script?.getAttribute("data-primary-color") || "#FF2D2D";
  const TITLE = script?.getAttribute("data-title") || "Assistant";
  const PLACEHOLDER = script?.getAttribute("data-placeholder") || "Type a message…";

  if (!AGENT_TOKEN) {
    console.warn("[Foji Widget] No data-agent-token provided — widget will not load.");
    return;
  }

  // ── Session ───────────────────────────────────────────────────────────────

  const SESSION_KEY = `foji_session_${AGENT_TOKEN}`;

  function getSessionId() {
    return sessionStorage.getItem(SESSION_KEY) || null;
  }

  function setSessionId(id) {
    sessionStorage.setItem(SESSION_KEY, id);
  }

  // ── State ─────────────────────────────────────────────────────────────────

  let isOpen = false;
  let isStreaming = false;
  let messages = []; // { role: "user"|"assistant", content: string }
  let shadowRoot = null;
  let agentInfo = null; // cached from GET /api/v1/widget/agent-info

  // ── Styles ────────────────────────────────────────────────────────────────

  const CSS = `
    :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    #foji-launcher {
      position: fixed;
      bottom: 24px;
      ${POSITION}: 24px;
      z-index: 999999;
      width: 56px; height: 56px;
      border-radius: 50%;
      background: ${PRIMARY};
      border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #foji-launcher:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
    #foji-launcher svg { width: 26px; height: 26px; fill: white; }

    #foji-window {
      position: fixed;
      bottom: 92px;
      ${POSITION}: 24px;
      z-index: 999998;
      width: 360px;
      max-height: 520px;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      display: flex; flex-direction: column;
      overflow: hidden;
      transform-origin: bottom ${POSITION};
      transition: transform 0.2s cubic-bezier(.34,1.56,.64,1), opacity 0.15s;
    }
    #foji-window.closed { transform: scale(0.85); opacity: 0; pointer-events: none; }

    #foji-header {
      background: ${PRIMARY};
      color: white;
      padding: 14px 16px;
      display: flex; align-items: center; gap: 10px;
    }
    #foji-header-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: rgba(255,255,255,0.25);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    #foji-header-avatar svg { width: 18px; height: 18px; fill: white; }
    #foji-header-title { font-weight: 600; font-size: 15px; flex: 1; }
    #foji-close {
      background: none; border: none; cursor: pointer;
      color: rgba(255,255,255,0.8); font-size: 20px; line-height: 1;
      padding: 2px; border-radius: 4px;
    }
    #foji-close:hover { color: white; }

    #foji-messages {
      flex: 1; overflow-y: auto;
      padding: 16px; display: flex; flex-direction: column; gap: 12px;
      background: #fafafa;
    }

    .foji-msg {
      max-width: 82%; padding: 10px 13px; border-radius: 12px;
      font-size: 14px; line-height: 1.5; word-break: break-word;
    }
    .foji-msg.user {
      align-self: flex-end;
      background: ${PRIMARY}; color: white;
      border-bottom-right-radius: 4px;
    }
    .foji-msg.assistant {
      align-self: flex-start;
      background: #fff; color: #111;
      border: 1px solid #e4e4e7;
      border-bottom-left-radius: 4px;
    }
    .foji-msg.typing { font-style: italic; color: #888; }

    .foji-dots { display: inline-flex; gap: 4px; align-items: center; }
    .foji-dots span {
      width: 6px; height: 6px; border-radius: 50%; background: #aaa;
      animation: foji-bounce 1.2s infinite ease-in-out;
    }
    .foji-dots span:nth-child(2) { animation-delay: 0.2s; }
    .foji-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes foji-bounce { 0%,80%,100% { transform: scale(0.7); } 40% { transform: scale(1); } }

    #foji-input-area {
      display: flex; gap: 8px; padding: 12px 14px;
      border-top: 1px solid #e4e4e7; background: #fff;
    }
    #foji-input {
      flex: 1; border: 1px solid #e4e4e7; border-radius: 20px;
      padding: 9px 14px; font-size: 14px; outline: none;
      background: #fafafa; resize: none; min-height: 40px; max-height: 120px;
      font-family: inherit; transition: border-color 0.15s;
    }
    #foji-input:focus { border-color: ${PRIMARY}; background: #fff; }
    #foji-send {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: ${PRIMARY}; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, transform 0.1s;
    }
    #foji-send:hover { background: ${PRIMARY}dd; }
    #foji-send:active { transform: scale(0.92); }
    #foji-send:disabled { opacity: 0.5; cursor: not-allowed; }
    #foji-send svg { width: 18px; height: 18px; fill: white; }

    #foji-powered {
      text-align: center; font-size: 11px; color: #aaa;
      padding: 4px 0 8px;
    }
    #foji-powered a { color: #aaa; text-decoration: none; }
    #foji-powered a:hover { color: ${PRIMARY}; }

    @media (max-width: 420px) {
      #foji-window { width: calc(100vw - 24px); ${POSITION}: 12px; }
    }
  `;

  // ── HTML ──────────────────────────────────────────────────────────────────

  const CHAT_ICON = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
  const CLOSE_ICON = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="white"/></svg>`;
  const SEND_ICON = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
  const BOT_ICON = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>`;

  // ── Mount ─────────────────────────────────────────────────────────────────

  function mount() {
    const host = document.createElement("div");
    host.id = "foji-widget-host";
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = CSS;
    shadowRoot.appendChild(style);

    shadowRoot.innerHTML += `
      <button id="foji-launcher" aria-label="Open chat">${CHAT_ICON}</button>

      <div id="foji-window" class="closed">
        <div id="foji-header">
          <div id="foji-header-avatar">${BOT_ICON}</div>
          <span id="foji-header-title">${escapeHtml(TITLE)}</span>
          <button id="foji-close" aria-label="Close">&times;</button>
        </div>
        <div id="foji-messages" role="log" aria-live="polite"></div>
        <div id="foji-input-area">
          <textarea
            id="foji-input"
            rows="1"
            placeholder="${escapeHtml(PLACEHOLDER)}"
            aria-label="Message"
          ></textarea>
          <button id="foji-send" aria-label="Send">${SEND_ICON}</button>
        </div>
        <div id="foji-powered">Powered by <a href="https://foji.ai" target="_blank">Foji AI</a></div>
      </div>
    `;

    // Style is already appended, innerHTML replaces everything else.
    // Re-append style:
    shadowRoot.prepend(style);

    bindEvents();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function bindEvents() {
    const launcher = shadowRoot.getElementById("foji-launcher");
    const win = shadowRoot.getElementById("foji-window");
    const closeBtn = shadowRoot.getElementById("foji-close");
    const input = shadowRoot.getElementById("foji-input");
    const sendBtn = shadowRoot.getElementById("foji-send");

    launcher.addEventListener("click", () => toggle());
    closeBtn.addEventListener("click", () => close());

    sendBtn.addEventListener("click", () => sendMessage());

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-grow textarea
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  async function open() {
    isOpen = true;
    const win = shadowRoot.getElementById("foji-window");
    win.classList.remove("closed");
    shadowRoot.getElementById("foji-input")?.focus();

    // Show personalized greeting on first open
    if (messages.length === 0) {
      try {
        if (!agentInfo) {
          const res = await fetch(`${API_URL}/api/v1/widget/agent-info?token=${encodeURIComponent(AGENT_TOKEN)}`);
          if (res.ok) agentInfo = await res.json();
        }
        const name = agentInfo?.name || TITLE;
        const greetings = {
          "pt-br": `Olá! Sou ${name}. Como posso ajudar?`,
          "es": `¡Hola! Soy ${name}. ¿Cómo puedo ayudarte?`,
        };
        const lang = agentInfo?.agent_language || "en";
        appendMessage("assistant", greetings[lang] || `Hi! I'm ${name}. How can I help you today?`);
      } catch {
        appendMessage("assistant", `Hi! I'm ${TITLE}. How can I help you today?`);
      }
    }
  }

  function close() {
    isOpen = false;
    shadowRoot.getElementById("foji-window").classList.add("closed");
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  async function sendMessage() {
    if (isStreaming) return;
    const input = shadowRoot.getElementById("foji-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.style.height = "auto";

    appendMessage("user", text);
    messages.push({ role: "user", content: text });

    const thinkingEl = appendTypingIndicator();
    setStreaming(true);

    try {
      const reply = await streamChat(text, thinkingEl);
      messages.push({ role: "assistant", content: reply });
    } catch (err) {
      removeElement(thinkingEl);
      appendMessage("assistant", "Sorry, something went wrong. Please try again.");
      console.error("[Foji Widget]", err);
    } finally {
      setStreaming(false);
    }
  }

  async function streamChat(userMessage, thinkingEl) {
    const sessionId = getSessionId();
    const res = await fetch(`${API_URL}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_token: AGENT_TOKEN,
        session_id: sessionId,   // null on first message — server assigns one
        message: userMessage,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `API error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    // Replace the typing indicator with an empty assistant bubble
    removeElement(thinkingEl);
    const msgEl = appendMessage("assistant", "");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // Process all complete SSE lines in the buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);

          if (parsed.chunk) {
            fullText += parsed.chunk;
            msgEl.textContent = fullText;
            scrollToBottom();
          }

          if (parsed.done && parsed.session_id) {
            // Persist the server-assigned session ID for conversation continuity
            setSessionId(parsed.session_id);
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          if (e.message && !e.message.startsWith("JSON")) throw e;
          // JSON parse errors on non-data lines — skip silently
        }
      }
    }

    return fullText;
  }

  // ── DOM Helpers ───────────────────────────────────────────────────────────

  function appendMessage(role, text) {
    const container = shadowRoot.getElementById("foji-messages");
    const el = document.createElement("div");
    el.className = `foji-msg ${role}`;
    el.textContent = text;
    container.appendChild(el);
    scrollToBottom();
    return el;
  }

  function appendTypingIndicator() {
    const container = shadowRoot.getElementById("foji-messages");
    const el = document.createElement("div");
    el.className = "foji-msg assistant typing";
    el.innerHTML = `<span class="foji-dots"><span></span><span></span><span></span></span>`;
    container.appendChild(el);
    scrollToBottom();
    return el;
  }

  function removeElement(el) {
    el?.parentNode?.removeChild(el);
  }

  function scrollToBottom() {
    const container = shadowRoot.getElementById("foji-messages");
    container.scrollTop = container.scrollHeight;
  }

  function setStreaming(val) {
    isStreaming = val;
    const btn = shadowRoot.getElementById("foji-send");
    if (btn) btn.disabled = val;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
