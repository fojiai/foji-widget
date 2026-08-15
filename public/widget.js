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
 *   data-api-url       Override the API base URL
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

  // document.currentScript is null for dynamically injected scripts (e.g. test.html),
  // so fall back to finding the script tag by its data attribute.
  const script = document.currentScript
    || document.querySelector("script[data-agent-token]");
  const AGENT_TOKEN = script?.getAttribute("data-agent-token") || "";
  const API_URL = (script?.getAttribute("data-api-url") || "__DEFAULT_API_URL__").replace(/\/$/, "");

  // Mutable — can be overridden by agent-info response
  let position = script?.getAttribute("data-position") || "right";
  let primary = script?.getAttribute("data-primary-color") || "#FF2D2D";
  let title = script?.getAttribute("data-title") || "Assistant";
  let placeholder = script?.getAttribute("data-placeholder") || "Type a message\u2026";

  if (!AGENT_TOKEN) {
    console.warn("[Foji Widget] No data-agent-token provided \u2014 widget will not load.");
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

  // ── Session lead capture ───────────────────────────────────────────────────

  const LEAD_KEY = `foji_lead_${AGENT_TOKEN}`;

  function hasSubmittedLead() {
    return sessionStorage.getItem(LEAD_KEY) === "1";
  }

  function markLeadSubmitted() {
    sessionStorage.setItem(LEAD_KEY, "1");
  }

  // ── State ─────────────────────────────────────────────────────────────────

  let isOpen = false;
  let isStreaming = false;
  let messages = []; // { role: "user"|"assistant", content: string }

  // The handoff button stays hidden until the visitor has actually tried the
  // agent this many times — offering a human immediately means most people
  // take it without ever using the bot.
  const HANDOFF_MIN_USER_MESSAGES = 3;
  let shadowRoot = null;
  let agentInfo = null; // cached from GET /api/v1/widget/agent-info
  let agentInfoPromise = null; // resolved when fetch completes

  // ── Styles (CSS custom properties for dynamic theming) ────────────────────

  function generateCSS() {
    const pos = position;
    return `
    :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    #foji-launcher {
      position: fixed;
      bottom: 24px;
      ${pos}: 24px;
      z-index: 999999;
      width: 56px; height: 56px;
      border-radius: 50%;
      background: var(--foji-primary, ${primary});
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
      ${pos}: 24px;
      z-index: 999998;
      width: 360px;
      max-height: 520px;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      display: flex; flex-direction: column;
      overflow: hidden;
      transform-origin: bottom ${pos};
      transition: transform 0.2s cubic-bezier(.34,1.56,.64,1), opacity 0.15s;
    }
    #foji-window.closed { transform: scale(0.85); opacity: 0; pointer-events: none; }

    #foji-header {
      background: var(--foji-primary, ${primary});
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
      background: var(--foji-primary, ${primary}); color: white;
      border-bottom-right-radius: 4px;
    }
    .foji-msg.assistant {
      align-self: flex-start;
      background: #fff; color: #111;
      border: 1px solid #e4e4e7;
      border-bottom-left-radius: 4px;
    }
    .foji-msg.typing { font-style: italic; color: #888; }

    .foji-msg.assistant h1, .foji-msg.assistant h2, .foji-msg.assistant h3 {
      font-weight: 600; margin: 8px 0 4px; line-height: 1.3;
    }
    .foji-msg.assistant h1 { font-size: 16px; }
    .foji-msg.assistant h2 { font-size: 15px; }
    .foji-msg.assistant h3 { font-size: 14px; }
    .foji-msg.assistant p { margin: 4px 0; }
    .foji-msg.assistant ul, .foji-msg.assistant ol {
      margin: 4px 0; padding-left: 20px;
    }
    .foji-msg.assistant li { margin: 2px 0; }
    .foji-msg.assistant strong { font-weight: 600; }
    .foji-msg.assistant em { font-style: italic; }
    .foji-msg.assistant code {
      background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px;
      font-family: monospace; font-size: 13px;
    }
    .foji-msg.assistant pre {
      background: #f4f4f5; padding: 8px 10px; border-radius: 6px;
      overflow-x: auto; margin: 6px 0;
    }
    .foji-msg.assistant pre code {
      background: none; padding: 0; font-size: 12px;
    }
    .foji-msg.assistant a { color: var(--foji-primary, ${primary}); text-decoration: underline; }
    .foji-msg.assistant blockquote {
      border-left: 3px solid #e4e4e7; padding-left: 10px; margin: 4px 0; color: #555;
    }
    .foji-msg.assistant hr { border: none; border-top: 1px solid #e4e4e7; margin: 8px 0; }

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
    #foji-input:focus { border-color: var(--foji-primary, ${primary}); background: #fff; }
    #foji-send {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: var(--foji-primary, ${primary}); border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, transform 0.1s;
    }
    #foji-send:hover { opacity: 0.9; }
    #foji-send:active { transform: scale(0.92); }
    #foji-send:disabled { opacity: 0.5; cursor: not-allowed; }
    #foji-send svg { width: 18px; height: 18px; fill: white; }

    #foji-powered {
      text-align: center; font-size: 11px; color: #aaa;
      padding: 4px 0 8px;
    }
    #foji-powered a { color: #aaa; text-decoration: none; }
    #foji-powered a:hover { color: var(--foji-primary, ${primary}); }

    #foji-handoff-btn {
      display: flex; align-items: center; gap: 6px;
      background: none; border: 1px solid #e4e4e7;
      border-radius: 20px; padding: 5px 12px;
      font-size: 12px; color: #555; cursor: pointer;
      font-family: inherit; transition: border-color 0.15s, color 0.15s;
      margin: 0 14px 8px; align-self: flex-start;
    }
    #foji-handoff-btn:hover { border-color: var(--foji-primary, ${primary}); color: var(--foji-primary, ${primary}); }
    #foji-handoff-btn svg { width: 13px; height: 13px; flex-shrink: 0; }
    #foji-handoff-btn.hidden { display: none; }

    .foji-starters {
      display: flex; flex-wrap: wrap; gap: 6px;
      align-self: flex-start; max-width: 95%;
    }
    .foji-starter-chip {
      background: #fff; color: var(--foji-primary, ${primary});
      border: 1px solid var(--foji-primary, ${primary});
      border-radius: 16px; padding: 6px 12px;
      font-size: 13px; cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .foji-starter-chip:hover {
      background: var(--foji-primary, ${primary}); color: white;
    }

    @media (max-width: 420px) {
      #foji-window { width: calc(100vw - 24px); ${pos}: 12px; }
    }

    #foji-lead-form {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #fafafa;
      border-bottom: 1px solid #e4e4e7;
    }
    #foji-lead-form p {
      font-size: 13px;
      color: #555;
      line-height: 1.4;
      margin: 0;
    }
    .foji-lead-input {
      width: 100%;
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 14px;
      outline: none;
      background: #fff;
      font-family: inherit;
      transition: border-color 0.15s;
    }
    .foji-lead-input:focus { border-color: var(--foji-primary, ${primary}); }
    #foji-lead-submit {
      padding: 9px 16px;
      background: var(--foji-primary, ${primary});
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.15s;
    }
    #foji-lead-submit:hover { opacity: 0.9; }
    #foji-lead-skip {
      background: none;
      border: none;
      font-size: 12px;
      color: #aaa;
      cursor: pointer;
      text-decoration: underline;
      font-family: inherit;
      align-self: center;
    }
    #foji-lead-skip:hover { color: #666; }

    /* ── Calendar card ───────────────────────────────────────────────────── */
    .foji-calendar-card {
      background: var(--foji-bg, #fff);
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 16px;
      margin: 8px 0;
      font-size: 13px;
    }
    .dark .foji-calendar-card {
      background: #1f2937;
      border-color: #374151;
    }
    .foji-calendar-card h4 {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 600;
      color: inherit;
    }
    .foji-slots {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }
    .foji-slot-btn {
      padding: 6px 12px;
      border: 1.5px solid #d1d5db;
      border-radius: 20px;
      background: transparent;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      color: inherit;
      transition: border-color 0.15s, background 0.15s;
    }
    .foji-slot-btn:hover { border-color: var(--foji-primary, #FF2D2D); }
    .foji-slot-btn.selected {
      border-color: var(--foji-primary, #FF2D2D);
      background: var(--foji-primary, #FF2D2D);
      color: #fff;
    }
    .foji-calendar-form {
      display: none;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .foji-calendar-form.visible { display: flex; }
    .foji-calendar-form input {
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      background: transparent;
      color: inherit;
      outline: none;
    }
    .foji-calendar-form input:focus { border-color: var(--foji-primary, #FF2D2D); }
    .foji-book-btn {
      padding: 9px 16px;
      background: var(--foji-primary, #FF2D2D);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.15s;
    }
    .foji-book-btn:hover { opacity: 0.9; }
    .foji-book-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .foji-calendar-msg {
      font-size: 12px;
      color: #6b7280;
      margin-top: 4px;
    }
  `;
  }

  // ── Theme application ─────────────────────────────────────────────────────

  function applyTheme() {
    if (!shadowRoot) return;

    // Update CSS custom property on the host
    const host = shadowRoot.host;
    host.style.setProperty("--foji-primary", primary);

    // Update style element (for position-dependent rules)
    const style = shadowRoot.querySelector("style");
    if (style) style.textContent = generateCSS();

    // Update header title
    const titleEl = shadowRoot.getElementById("foji-header-title");
    if (titleEl) titleEl.textContent = title;

    // Update input placeholder
    const input = shadowRoot.getElementById("foji-input");
    if (input) input.placeholder = placeholder;
  }

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
    style.textContent = generateCSS();
    shadowRoot.appendChild(style);

    const HANDOFF_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;

    shadowRoot.innerHTML += `
      <button id="foji-launcher" aria-label="Open chat">${CHAT_ICON}</button>

      <div id="foji-window" class="closed">
        <div id="foji-header">
          <div id="foji-header-avatar">${BOT_ICON}</div>
          <span id="foji-header-title">${escapeHtml(title)}</span>
          <button id="foji-close" aria-label="Close">&times;</button>
        </div>
        <div id="foji-messages" role="log" aria-live="polite"></div>
        <button id="foji-handoff-btn" class="hidden" aria-label="Talk to a human">
          ${HANDOFF_ICON} <span id="foji-handoff-label">Talk to a human</span>
        </button>
        <div id="foji-input-area">
          <textarea
            id="foji-input"
            rows="1"
            placeholder="${escapeHtml(placeholder)}"
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

    // Fetch agent info at mount to apply theming early — store the promise
    // so open() can await it before showing the greeting.
    agentInfoPromise = fetchAgentInfo();
  }

  // ── Agent Info ────────────────────────────────────────────────────────────

  async function fetchAgentInfo() {
    try {
      const res = await fetch(`${API_URL}/api/v1/widget/agent-info`, {
        headers: { "X-Agent-Token": AGENT_TOKEN },
      });
      if (res.ok) {
        agentInfo = await res.json();

        // Apply server-side widget customization overrides
        if (agentInfo.widget_primary_color) primary = agentInfo.widget_primary_color;
        if (agentInfo.widget_title) title = agentInfo.widget_title;
        if (agentInfo.widget_placeholder) placeholder = agentInfo.widget_placeholder;
        if (agentInfo.widget_position) position = agentInfo.widget_position;

        applyTheme();
      }
    } catch {
      // Silently fail — widget works fine without customization
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function bindEvents() {
    const launcher = shadowRoot.getElementById("foji-launcher");
    const win = shadowRoot.getElementById("foji-window");
    const closeBtn = shadowRoot.getElementById("foji-close");
    const input = shadowRoot.getElementById("foji-input");
    const sendBtn = shadowRoot.getElementById("foji-send");
    const handoffBtn = shadowRoot.getElementById("foji-handoff-btn");

    launcher.addEventListener("click", () => toggle());
    closeBtn.addEventListener("click", () => close());

    sendBtn.addEventListener("click", () => sendMessage());
    handoffBtn.addEventListener("click", () => requestHandoff());

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

    // Wait for agent info before showing greeting (so name/language/custom msg are available)
    if (agentInfoPromise) {
      await agentInfoPromise;
      agentInfoPromise = null;
    }

    // Show greeting on first open only
    if (messages.length === 0) {
      // Show lead capture form before greeting if enabled and not yet submitted
      if (agentInfo?.lead_capture_enabled && !hasSubmittedLead()) {
        renderLeadForm();
        return;
      }

      showGreetingAndStarters();
    }
  }

  function updateHandoffButton() {
    const btn = shadowRoot.getElementById("foji-handoff-btn");
    if (!btn) return;
    if (!agentInfo?.handoff_enabled) { btn.classList.add("hidden"); return; }

    const userTurns = messages.filter((m) => m.role === "user").length;
    if (userTurns < HANDOFF_MIN_USER_MESSAGES) { btn.classList.add("hidden"); return; }

    btn.classList.remove("hidden");
    const lang = agentInfo?.agent_language || "En";
    const label = lang === "PtBr" ? "Falar com um humano" : lang === "Es" ? "Hablar con humano" : "Talk to a human";
    const labelEl = shadowRoot.getElementById("foji-handoff-label");
    if (labelEl) labelEl.textContent = label;
  }

  function showGreetingAndStarters() {
    // Use custom welcome message if set, otherwise language-based greeting
    const welcomeMsg = agentInfo?.welcome_message;
    let greeting;
    if (welcomeMsg) {
      greeting = welcomeMsg;
    } else {
      const name = agentInfo?.name || title;
      const greetings = {
        "PtBr": `Ol\u00e1! Sou ${name}. Como posso ajudar?`,
        "Es": `\u00a1Hola! Soy ${name}. \u00bfC\u00f3mo puedo ayudarte?`,
      };
      const lang = agentInfo?.agent_language || "En";
      greeting = greetings[lang] || `Hi! I'm ${name}. How can I help you today?`;
    }
    appendMessage("assistant", greeting);
    messages.push({ role: "assistant", content: greeting });

    // Show conversation starters if available
    const starters = agentInfo?.conversation_starters;
    if (Array.isArray(starters) && starters.length > 0) {
      renderStarters(starters);
    }

    // Show/hide human handoff button based on agent config
    updateHandoffButton();
  }

  async function requestHandoff() {
    const btn = shadowRoot.getElementById("foji-handoff-btn");
    if (btn) btn.disabled = true;

    const lang = agentInfo?.agent_language || "En";
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || null;

    // Optimistic UI — show confirmation message immediately
    const confirmMsg = agentInfo?.handoff_message || (
      lang === "PtBr" ? "Sua solicitação foi registrada! Nossa equipe entrará em contato em breve." :
      lang === "Es" ? "¡Solicitud registrada! Nuestro equipo se pondrá en contacto pronto." :
      "Request registered! Our team will reach out to you shortly."
    );
    appendMessage("assistant", confirmMsg);
    messages.push({ role: "assistant", content: confirmMsg });
    if (btn) btn.classList.add("hidden"); // hide after use

    try {
      const sessionId = getSessionId() || `pre_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setSessionId(sessionId);

      await fetch(`${API_URL}/api/v1/widget/handoff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Token": AGENT_TOKEN,
        },
        body: JSON.stringify({
          session_id: sessionId,
          user_message: lastUserMsg,
        }),
      });
    } catch (err) {
      console.warn("[Foji Widget] Handoff request failed:", err);
    }
  }

  function close() {
    isOpen = false;
    shadowRoot.getElementById("foji-window").classList.add("closed");
  }

  // ── Lead Capture Form ─────────────────────────────────────────────────────

  function renderLeadForm() {
    const lang = agentInfo?.agent_language || "En";
    const isPtBr = lang === "PtBr";
    const isEs = lang === "Es";

    const promptText = agentInfo?.lead_capture_prompt || (
      isPtBr ? "Para melhor te atender, deixe seus contatos (opcionais):" :
      isEs ? "Para atenderte mejor, d\u00e9janos tus datos (opcionales):" :
      "Leave your contact info so we can follow up (optional):"
    );
    const namePlaceholder = isPtBr ? "Nome" : isEs ? "Nombre" : "Name";
    const emailPlaceholder = "E-mail";
    const phonePlaceholder = isPtBr ? "Telefone" : isEs ? "Tel\u00e9fono" : "Phone";
    const submitLabel = isPtBr ? "Iniciar conversa" : isEs ? "Iniciar conversaci\u00f3n" : "Start chat";
    const skipLabel = isPtBr ? "Pular" : isEs ? "Omitir" : "Skip";

    // Inject form above the message list
    const win = shadowRoot.getElementById("foji-window");
    const msgArea = shadowRoot.getElementById("foji-messages");

    const form = document.createElement("div");
    form.id = "foji-lead-form";
    form.innerHTML = `
      <p>${escapeHtml(promptText)}</p>
      <input class="foji-lead-input" id="foji-lead-name" type="text" placeholder="${escapeHtml(namePlaceholder)}" autocomplete="name" />
      <input class="foji-lead-input" id="foji-lead-email" type="email" placeholder="${escapeHtml(emailPlaceholder)}" autocomplete="email" />
      <input class="foji-lead-input" id="foji-lead-phone" type="tel" placeholder="${escapeHtml(phonePlaceholder)}" autocomplete="tel" />
      <button id="foji-lead-submit">${escapeHtml(submitLabel)}</button>
      <button id="foji-lead-skip">${escapeHtml(skipLabel)}</button>
    `;

    win.insertBefore(form, msgArea);

    shadowRoot.getElementById("foji-lead-submit").addEventListener("click", async () => {
      const name = shadowRoot.getElementById("foji-lead-name")?.value.trim();
      const email = shadowRoot.getElementById("foji-lead-email")?.value.trim();
      const phone = shadowRoot.getElementById("foji-lead-phone")?.value.trim();
      await submitLead(name, email, phone);
    });

    shadowRoot.getElementById("foji-lead-skip").addEventListener("click", () => {
      removeLeadForm();
      markLeadSubmitted();
      showGreetingAndStarters();
    });
  }

  async function submitLead(name, email, phone) {
    const sessionId = getSessionId() || `pre_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setSessionId(sessionId);

    try {
      await fetch(`${API_URL}/api/v1/widget/lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Token": AGENT_TOKEN,
        },
        body: JSON.stringify({ session_id: sessionId, name: name || null, email: email || null, phone: phone || null }),
      });
    } catch {
      // Silently fail — don't block the chat if lead capture fails
    }

    removeLeadForm();
    markLeadSubmitted();
    showGreetingAndStarters();
  }

  function removeLeadForm() {
    const form = shadowRoot.getElementById("foji-lead-form");
    if (form) form.remove();
  }

  // ── Conversation Starters ─────────────────────────────────────────────────

  function renderStarters(starters) {
    const container = shadowRoot.getElementById("foji-messages");
    const wrap = document.createElement("div");
    wrap.className = "foji-starters";
    wrap.id = "foji-starters";

    starters.slice(0, 4).forEach((text) => {
      if (!text || !text.trim()) return;
      const chip = document.createElement("button");
      chip.className = "foji-starter-chip";
      chip.textContent = text.trim();
      chip.addEventListener("click", () => {
        removeStarters();
        const input = shadowRoot.getElementById("foji-input");
        input.value = text.trim();
        sendMessage();
      });
      wrap.appendChild(chip);
    });

    if (wrap.children.length > 0) {
      container.appendChild(wrap);
      scrollToBottom();
    }
  }

  function removeStarters() {
    const el = shadowRoot.getElementById("foji-starters");
    if (el) el.remove();
  }

  // ── Google Calendar Card ──────────────────────────────────────────────────

  function formatSlot(slot) {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const dateStr = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const startTime = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const endTime = end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${dateStr} · ${startTime}–${endTime}`;
  }

  function renderCalendarCard(suggestion) {
    const msgArea = shadowRoot.getElementById("foji-messages");
    if (!msgArea) return;

    const slots = suggestion.slots || [];
    if (!slots.length) return;

    const card = document.createElement("div");
    card.className = "foji-calendar-card";

    const heading = document.createElement("h4");
    heading.textContent = suggestion.title || "Choose a time";
    card.appendChild(heading);

    const slotsDiv = document.createElement("div");
    slotsDiv.className = "foji-slots";

    let selectedSlot = null;

    slots.forEach((slot) => {
      const btn = document.createElement("button");
      btn.className = "foji-slot-btn";
      btn.textContent = formatSlot(slot);
      btn.addEventListener("click", () => {
        slotsDiv.querySelectorAll(".foji-slot-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedSlot = slot;
        form.classList.add("visible");
      });
      slotsDiv.appendChild(btn);
    });

    card.appendChild(slotsDiv);

    const form = document.createElement("div");
    form.className = "foji-calendar-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Your name";
    nameInput.autocomplete = "name";

    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.placeholder = "Your email";
    emailInput.autocomplete = "email";

    const notesInput = document.createElement("input");
    notesInput.type = "text";
    notesInput.placeholder = "Notes (optional)";

    const bookBtn = document.createElement("button");
    bookBtn.className = "foji-book-btn";
    bookBtn.textContent = "Confirm booking";

    const msgEl = document.createElement("p");
    msgEl.className = "foji-calendar-msg";

    bookBtn.addEventListener("click", async () => {
      if (!selectedSlot) return;
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      if (!name || !email) {
        msgEl.textContent = "Please fill in your name and email.";
        return;
      }
      await submitBooking(selectedSlot, name, email, notesInput.value.trim(), card);
    });

    form.appendChild(nameInput);
    form.appendChild(emailInput);
    form.appendChild(notesInput);
    form.appendChild(bookBtn);
    form.appendChild(msgEl);
    card.appendChild(form);

    msgArea.appendChild(card);
    scrollToBottom();
  }

  async function submitBooking(slot, name, email, notes, cardEl) {
    const bookBtn = cardEl.querySelector(".foji-book-btn");
    const msgEl = cardEl.querySelector(".foji-calendar-msg");
    if (bookBtn) { bookBtn.disabled = true; bookBtn.textContent = "Booking…"; }

    try {
      const res = await fetch(`${API_URL}/api/v1/calendar/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_token: AGENT_TOKEN,
          attendee_name: name,
          attendee_email: email,
          slot_start: slot.start,
          slot_end: slot.end,
          notes: notes || undefined,
        }),
      });

      if (res.status === 409) {
        if (msgEl) msgEl.textContent = "That slot was just taken. Please choose another time.";
        if (bookBtn) { bookBtn.disabled = false; bookBtn.textContent = "Confirm booking"; }
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (msgEl) msgEl.textContent = err.detail || "Booking failed. Please try again.";
        if (bookBtn) { bookBtn.disabled = false; bookBtn.textContent = "Confirm booking"; }
        return;
      }

      const data = await res.json();
      cardEl.remove();
      appendMessage("assistant", data.message || "Your appointment is confirmed! Check your email for the invite.");
      scrollToBottom();
    } catch {
      if (msgEl) msgEl.textContent = "Network error. Please try again.";
      if (bookBtn) { bookBtn.disabled = false; bookBtn.textContent = "Confirm booking"; }
    }
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  async function sendMessage() {
    if (isStreaming) return;
    const input = shadowRoot.getElementById("foji-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.style.height = "auto";

    // Remove starters on first user message
    removeStarters();

    appendMessage("user", text);
    messages.push({ role: "user", content: text });
    updateHandoffButton(); // may cross the threshold on this turn

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
            msgEl.innerHTML = renderMarkdown(fullText);
            scrollToBottom();
          }

          if (parsed.replace_last) {
            fullText = parsed.replace_last;
            msgEl.innerHTML = renderMarkdown(fullText);
            scrollToBottom();
          }

          if (parsed.done && parsed.session_id) {
            // Persist the server-assigned session ID for conversation continuity
            setSessionId(parsed.session_id);
          }

          if (parsed.calendar_suggestion && agentInfo?.calendar_enabled) {
            renderCalendarCard(parsed.calendar_suggestion);
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

  // ── Markdown Renderer ─────────────────────────────────────────────────────

  /**
   * Lightweight markdown-to-HTML renderer for assistant messages.
   * Supports: headings, bold, italic, inline code, code blocks,
   * unordered/ordered lists, links, blockquotes, horizontal rules, paragraphs.
   */
  function renderMarkdown(text) {
    if (!text) return "";

    // Escape HTML first to prevent XSS
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_m, _lang, code) {
      return '<pre><code>' + code.trim() + '</code></pre>';
    });

    // Split into lines for block-level processing
    const lines = html.split('\n');
    const result = [];
    let inList = false;
    let listType = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines (close any open list)
      if (!line.trim()) {
        if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
        i++;
        continue;
      }

      // Headings
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
        const level = headingMatch[1].length;
        result.push('<h' + level + '>' + inlineFormat(headingMatch[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
        result.push('<hr>');
        i++;
        continue;
      }

      // Blockquote
      if (line.match(/^&gt;\s?(.*)$/)) {
        if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
        const quoteText = line.replace(/^&gt;\s?/, '');
        result.push('<blockquote>' + inlineFormat(quoteText) + '</blockquote>');
        i++;
        continue;
      }

      // Unordered list item
      const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
          result.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        result.push('<li>' + inlineFormat(ulMatch[1]) + '</li>');
        i++;
        continue;
      }

      // Ordered list item
      const olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)$/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
          result.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        result.push('<li>' + inlineFormat(olMatch[1]) + '</li>');
        i++;
        continue;
      }

      // Regular paragraph
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      result.push('<p>' + inlineFormat(line) + '</p>');
      i++;
    }

    if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
    return result.join('');
  }

  /** Applies inline formatting: bold, italic, code, links */
  function inlineFormat(text) {
    return text
      // Inline code (must come before bold/italic to avoid conflicts)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold + italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Links [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  // ── DOM Helpers ───────────────────────────────────────────────────────────

  function appendMessage(role, text) {
    const container = shadowRoot.getElementById("foji-messages");
    const el = document.createElement("div");
    el.className = `foji-msg ${role}`;
    if (role === "assistant" && text) {
      el.innerHTML = renderMarkdown(text);
    } else {
      el.textContent = text;
    }
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
