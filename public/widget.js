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

  // Everything the visitor can read, in the agent's language. Several of these
  // used to be hard-coded English ("Sorry, something went wrong") on sites that
  // are otherwise entirely in Portuguese.
  const STRINGS = {
    PtBr: {
      greeting: "Oi! \u{1F44B} Como posso te ajudar?",
      greetingNamed: "Oi! \u{1F44B} Aqui é {name} — como posso te ajudar?",
      greetingCompany: "Oi! \u{1F44B} Aqui é da equipe {company} — como posso te ajudar?",
      placeholder: "Digite sua mensagem…",
      genericError: "Ops, tive um probleminha pra responder agora \u{1F605} Pode tentar de novo em alguns segundos?",
      timeout: "Opa, demorei demais pra responder \u{1F605} Pode mandar de novo?",
      limitReached: "No momento não consigo responder por aqui. Se puder, fale com a gente por outro canal \u{1F642}",
      handoffDone: "Pronto! Já avisei a equipe — alguém vai falar com você em breve. \u{1F642}",
      handoffFailed: "Não consegui chamar a equipe agora. Pode tentar de novo em instantes?",
      chooseTime: "Escolha um horário",
      yourName: "Seu nome",
      yourEmail: "Seu e-mail",
      notes: "Observações (opcional)",
      confirmBooking: "Confirmar agendamento",
      booking: "Agendando…",
      fillNameEmail: "Preencha seu nome e e-mail, por favor.",
      slotTaken: "Esse horário acabou de ser reservado. Pode escolher outro?",
      bookingFailed: "Não consegui agendar agora. Pode tentar de novo?",
      bookingConfirmed: "Agendado! ✅ Você vai receber o convite por e-mail.",
      networkError: "Parece que a conexão caiu. Pode tentar de novo?",
      attachPhoto: "Enviar foto",
      removePhoto: "Remover",
      photoTooBig: "Essa foto ficou grande demais pra enviar por aqui 😅 Pode tentar outra?",
      photoUnsupported: "Não consegui abrir essa foto 😅 Pode tentar outra imagem?",
    },
    Es: {
      greeting: "¡Hola! \u{1F44B} ¿En qué te puedo ayudar?",
      greetingNamed: "¡Hola! \u{1F44B} Soy {name} — ¿en qué te puedo ayudar?",
      greetingCompany: "¡Hola! \u{1F44B} Te habla el equipo de {company} — ¿en qué te puedo ayudar?",
      placeholder: "Escribe tu mensaje…",
      genericError: "Uy, tuve un problemita para responder \u{1F605} ¿Puedes intentarlo de nuevo en unos segundos?",
      timeout: "Ups, tardé demasiado en responder \u{1F605} ¿Me lo mandas de nuevo?",
      limitReached: "En este momento no puedo responder por aquí. Si puedes, contáctanos por otro canal \u{1F642}",
      handoffDone: "¡Listo! Ya avisé al equipo — alguien hablará contigo pronto. \u{1F642}",
      handoffFailed: "No pude avisar al equipo ahora. ¿Lo intentas de nuevo en un momento?",
      chooseTime: "Elige un horario",
      yourName: "Tu nombre",
      yourEmail: "Tu correo",
      notes: "Notas (opcional)",
      confirmBooking: "Confirmar cita",
      booking: "Agendando…",
      fillNameEmail: "Completa tu nombre y correo, por favor.",
      slotTaken: "Ese horario acaba de reservarse. ¿Puedes elegir otro?",
      bookingFailed: "No pude agendar ahora. ¿Lo intentas de nuevo?",
      bookingConfirmed: "¡Listo! ✅ Te llegará la invitación por correo.",
      networkError: "Parece que se cayó la conexión. ¿Lo intentas de nuevo?",
      attachPhoto: "Enviar foto",
      removePhoto: "Quitar",
      photoTooBig: "Esa foto es demasiado grande para enviarla por aquí 😅 ¿Probamos con otra?",
      photoUnsupported: "No pude abrir esa foto 😅 ¿Puedes probar con otra imagen?",
    },
    En: {
      greeting: "Hi there! \u{1F44B} How can I help?",
      greetingNamed: "Hi there! \u{1F44B} I'm {name} — how can I help?",
      greetingCompany: "Hi there! \u{1F44B} This is the {company} team — how can I help?",
      placeholder: "Type a message…",
      genericError: "Oops, I had a little trouble answering just now \u{1F605} Could you try again in a few seconds?",
      timeout: "Sorry, that took me too long \u{1F605} Could you send it again?",
      limitReached: "I can't reply here right now. If you can, please reach us through another channel \u{1F642}",
      handoffDone: "Done! I've let the team know — someone will be with you shortly. \u{1F642}",
      handoffFailed: "I couldn't reach the team just now. Could you try again in a moment?",
      chooseTime: "Choose a time",
      yourName: "Your name",
      yourEmail: "Your email",
      notes: "Notes (optional)",
      confirmBooking: "Confirm booking",
      booking: "Booking…",
      fillNameEmail: "Please fill in your name and email.",
      slotTaken: "That slot was just taken. Could you pick another time?",
      bookingFailed: "I couldn't book that just now. Could you try again?",
      bookingConfirmed: "You're booked! ✅ Check your email for the invite.",
      networkError: "Looks like the connection dropped. Could you try again?",
      attachPhoto: "Send a photo",
      removePhoto: "Remove",
      photoTooBig: "That photo is too large to send here 😅 Could you try another one?",
      photoUnsupported: "I couldn't open that photo 😅 Could you try a different image?",
    },
  };

  function tr(key, vars) {
    const lang = agentInfo?.agent_language || "PtBr";
    let s = (STRINGS[lang] || STRINGS.PtBr)[key] ?? STRINGS.En[key] ?? key;
    if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
    return s;
  }
  let agentInfoPromise = null; // resolved when fetch completes

  // ── Colour (the business picks any colour; the chat must stay readable) ────

  /** "#abc" / "abc" / "#AABBCC" → "#aabbcc"; anything else → the Foji red. */
  function safeHex(value) {
    let v = String(value || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(v)) v = v.split("").map((c) => c + c).join("");
    return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toLowerCase() : "#ff2d2d";
  }

  function luminance(hex) {
    const ch = (i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  }

  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  /**
   * Text and icons that sit on the chosen colour: white, unless dark text
   * reads better (a white, yellow or pastel pick used to make the header,
   * the visitor's own bubbles and the send button white on white).
   */
  function onPrimary(hex) {
    const l = luminance(hex);
    return contrast(1, l) >= contrast(l, 0.0156) ? "#ffffff" : "#1f2937";
  }

  /** The colour used on white (links, focus rings): falls back to dark grey when the pick is too pale to see. */
  function accentOnWhite(hex) {
    return contrast(1, luminance(hex)) >= 2.2 ? hex : "#1f2937";
  }

  /** A very light pick needs an outline, or the launcher and header vanish into a white page. */
  function needsOutline(hex) {
    return luminance(hex) > 0.8;
  }

  // ── Styles (CSS custom properties for dynamic theming) ────────────────────

  function generateCSS() {
    const pos = position;
    primary = safeHex(primary);
    const ink = onPrimary(primary);
    const accent = accentOnWhite(primary);
    const outline = needsOutline(primary) ? "1px solid #e4e4e7" : "none";
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
      border: ${outline}; cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #foji-launcher:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
    #foji-launcher svg { width: 26px; height: 26px; fill: var(--foji-on-primary, ${ink}); }

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
      color: var(--foji-on-primary, ${ink});
      border-bottom: ${outline};
      padding: 14px 16px;
      display: flex; align-items: center; gap: 10px;
    }
    #foji-header-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: rgba(127,127,127,0.2);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    #foji-header-avatar svg { width: 18px; height: 18px; fill: var(--foji-on-primary, ${ink}); }
    #foji-header-title { font-weight: 600; font-size: 15px; flex: 1; }
    #foji-close {
      background: none; border: none; cursor: pointer;
      color: var(--foji-on-primary, ${ink}); opacity: 0.8; font-size: 20px; line-height: 1;
      padding: 2px; border-radius: 4px;
    }
    #foji-close:hover { opacity: 1; }

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
      background: var(--foji-primary, ${primary}); color: var(--foji-on-primary, ${ink});
      border: ${outline};
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
    .foji-msg.assistant a { color: var(--foji-accent, ${accent}); text-decoration: underline; }
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
    @keyframes foji-bounce {
      0%, 80%, 100% { transform: translateY(0) scale(0.7); opacity: 0.45; }
      40%           { transform: translateY(-3px) scale(1); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .foji-dots span { animation: foji-fade 1.4s infinite ease-in-out; }
      @keyframes foji-fade { 0%,80%,100% { opacity: 0.45; } 40% { opacity: 1; } }
    }

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
    #foji-input:focus { border-color: var(--foji-accent, ${accent}); background: #fff; }
    #foji-send {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: var(--foji-primary, ${primary}); border: ${outline}; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, transform 0.1s;
    }
    #foji-send:hover { opacity: 0.9; }
    #foji-send:active { transform: scale(0.92); }
    #foji-send:disabled { opacity: 0.5; cursor: not-allowed; }
    #foji-send svg { width: 18px; height: 18px; fill: var(--foji-on-primary, ${ink}); }

    #foji-attach {
      width: 34px; height: 40px; flex-shrink: 0; border: none; background: transparent;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      color: #71717a; border-radius: 50%; padding: 0; transition: color 0.15s;
    }
    #foji-attach:hover { color: var(--foji-accent, ${accent}); }
    #foji-attach:disabled { opacity: 0.5; cursor: not-allowed; }
    #foji-attach svg { width: 22px; height: 22px; fill: currentColor; }
    #foji-attachment {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px 0;
      background: #fff; border-top: 1px solid #e4e4e7;
    }
    #foji-attachment.hidden { display: none; }
    #foji-attachment:not(.hidden) + #foji-input-area { border-top: none; }
    #foji-attachment img {
      width: 52px; height: 52px; object-fit: cover; border-radius: 8px; border: 1px solid #e4e4e7;
    }
    #foji-attachment button {
      border: none; background: #f4f4f5; color: #52525b; border-radius: 999px;
      font-size: 12px; padding: 5px 10px; cursor: pointer; font-family: inherit;
    }
    .foji-msg img.foji-photo {
      display: block; max-width: 100%; max-height: 220px; border-radius: 10px;
    }
    .foji-msg img.foji-photo + span { display: block; margin-top: 6px; }

    #foji-powered {
      text-align: center; font-size: 11px; color: #aaa;
      padding: 4px 0 8px;
    }
    #foji-powered a { color: #aaa; text-decoration: none; }
    #foji-powered a:hover { color: var(--foji-accent, ${accent}); }

    #foji-handoff-btn {
      display: flex; align-items: center; gap: 6px;
      background: none; border: 1px solid #e4e4e7;
      border-radius: 20px; padding: 5px 12px;
      font-size: 12px; color: #555; cursor: pointer;
      font-family: inherit; transition: border-color 0.15s, color 0.15s;
      margin: 0 14px 8px; align-self: flex-start;
    }
    #foji-handoff-btn:hover { border-color: var(--foji-accent, ${accent}); color: var(--foji-accent, ${accent}); }
    #foji-handoff-btn svg { width: 13px; height: 13px; flex-shrink: 0; }
    #foji-handoff-btn.hidden { display: none; }

    .foji-starters {
      display: flex; flex-wrap: wrap; gap: 6px;
      align-self: flex-start; max-width: 95%;
    }
    .foji-starter-chip {
      background: #fff; color: var(--foji-accent, ${accent});
      border: 1px solid var(--foji-accent, ${accent});
      border-radius: 16px; padding: 6px 12px;
      font-size: 13px; cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .foji-starter-chip:hover {
      background: var(--foji-primary, ${primary}); color: var(--foji-on-primary, ${ink});
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
    .foji-lead-input:focus { border-color: var(--foji-accent, ${accent}); }
    #foji-lead-submit {
      padding: 9px 16px;
      background: var(--foji-primary, ${primary});
      color: var(--foji-on-primary, ${ink});
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
    .foji-slot-btn:hover { border-color: var(--foji-accent, ${accent}); }
    .foji-slot-btn.selected {
      border-color: var(--foji-primary, #FF2D2D);
      background: var(--foji-primary, #FF2D2D);
      color: var(--foji-on-primary, ${ink});
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
    .foji-calendar-form input:focus { border-color: var(--foji-accent, ${accent}); }
    .foji-book-btn {
      padding: 9px 16px;
      background: var(--foji-primary, #FF2D2D);
      color: var(--foji-on-primary, ${ink});
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
    primary = safeHex(primary);
    host.style.setProperty("--foji-primary", primary);
    host.style.setProperty("--foji-on-primary", onPrimary(primary));
    host.style.setProperty("--foji-accent", accentOnWhite(primary));

    // Update style element (for position-dependent rules)
    const style = shadowRoot.querySelector("style");
    if (style) style.textContent = generateCSS();

    // Update header title
    const titleEl = shadowRoot.getElementById("foji-header-title");
    if (titleEl) titleEl.textContent = title;

    // Update input placeholder
    const input = shadowRoot.getElementById("foji-input");
    if (input) input.placeholder = placeholder;

    // The photo controls render before the agent's language is known.
    const attach = shadowRoot.getElementById("foji-attach");
    if (attach) { attach.setAttribute("aria-label", tr("attachPhoto")); attach.title = tr("attachPhoto"); }
    const remove = shadowRoot.getElementById("foji-attachment-remove");
    if (remove) remove.textContent = tr("removePhoto");
  }

  // ── Photos ────────────────────────────────────────────────────────────────

  // Phone photos are often 5–12 MB. Downsize in the browser so sending is fast
  // and the model gets a sensible size; 1600px keeps text in screenshots legible.
  const PHOTO_MAX_EDGE = 1600;
  const PHOTO_QUALITY = 0.85;
  const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
  let pendingPhoto = null; // { base64, mime, dataUrl } until the next send

  function preparePhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) return reject(new Error("unsupported"));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; // transparent PNGs become white, not black, as JPEG
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          if (base64.length * 0.75 > PHOTO_MAX_BYTES) return reject(new Error("too_big"));
          resolve({ base64, mime: "image/jpeg", dataUrl });
        } catch (e) {
          reject(new Error("unsupported"));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unsupported")); };
      img.src = url;
    });
  }

  function setPendingPhoto(photo) {
    pendingPhoto = photo;
    const row = shadowRoot.getElementById("foji-attachment");
    const preview = shadowRoot.getElementById("foji-attachment-img");
    if (!row || !preview) return;
    if (photo) {
      preview.src = photo.dataUrl;
      row.classList.remove("hidden");
    } else {
      preview.removeAttribute("src");
      row.classList.add("hidden");
    }
  }

  /** The visitor's own bubble, with the photo above the text. Built with DOM
   *  APIs, never innerHTML — the text is whatever they typed. */
  function appendUserMessage(text, photoDataUrl) {
    const container = shadowRoot.getElementById("foji-messages");
    const el = document.createElement("div");
    el.className = "foji-msg user";
    if (photoDataUrl) {
      const img = document.createElement("img");
      img.className = "foji-photo";
      img.alt = "";
      img.src = photoDataUrl;
      img.addEventListener("load", scrollToBottom);
      el.appendChild(img);
    }
    if (text) {
      const span = document.createElement("span");
      span.textContent = text;
      el.appendChild(span);
    }
    container.appendChild(el);
    scrollToBottom();
    return el;
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  const CHAT_ICON = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
  const CLOSE_ICON = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="white"/></svg>`;
  const SEND_ICON = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
  const PHOTO_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
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
        <div id="foji-attachment" class="hidden">
          <img id="foji-attachment-img" alt="" />
          <button id="foji-attachment-remove" type="button">${escapeHtml(tr("removePhoto"))}</button>
        </div>
        <div id="foji-input-area">
          <button id="foji-attach" type="button" aria-label="${escapeHtml(tr("attachPhoto"))}" title="${escapeHtml(tr("attachPhoto"))}">${PHOTO_ICON}</button>
          <input id="foji-file" type="file" accept="image/*" hidden />
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
        // Title: dashboard setting > embed attribute > the agent's name (what the
        // business called it — "Indi") > the company's name. "Assistant" was
        // the old fallback — exactly the word a visitor shouldn't see.
        if (agentInfo.widget_title) title = agentInfo.widget_title;
        else if (!script?.getAttribute("data-title") && (agentInfo.name || agentInfo.company_name))
          title = agentInfo.name || agentInfo.company_name;
        if (agentInfo.widget_placeholder) placeholder = agentInfo.widget_placeholder;
        else if (!script?.getAttribute("data-placeholder")) placeholder = tr("placeholder");
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

    const attachBtn = shadowRoot.getElementById("foji-attach");
    const fileInput = shadowRoot.getElementById("foji-file");
    const removeBtn = shadowRoot.getElementById("foji-attachment-remove");
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = ""; // picking the same file again should still fire
      if (!file) return;
      try {
        setPendingPhoto(await preparePhoto(file));
        input.focus();
      } catch (err) {
        appendMessage("assistant", tr(err && err.message === "too_big" ? "photoTooBig" : "photoUnsupported"));
      }
    });
    removeBtn.addEventListener("click", () => setPendingPhoto(null));

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
      // Introduce the agent by the name the business gave it ("Aqui \u00e9 Indi");
      // if it's just named after the company, say it's the company's team.
      const name = (agentInfo?.name || "").trim();
      const company = (agentInfo?.company_name || "").trim();
      if (name && name.toLowerCase() !== company.toLowerCase()) greeting = tr("greetingNamed", { name });
      else if (company) greeting = tr("greetingCompany", { company });
      else greeting = tr("greeting");
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

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || null;

    // Only confirm once the team has actually been notified. This used to say
    // "our team will contact you" before the request went out, so a failure
    // left the visitor waiting for someone who was never told.
    let ok = false;
    try {
      const sessionId = getSessionId() || `pre_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setSessionId(sessionId);

      const res = await fetch(`${API_URL}/api/v1/widget/handoff`, {
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
      ok = res.ok;
      if (!ok) console.warn("[Foji Widget] Handoff request failed:", res.status);
    } catch (err) {
      console.warn("[Foji Widget] Handoff request failed:", err);
    }

    if (ok) {
      const confirmMsg = agentInfo?.handoff_message || tr("handoffDone");
      appendMessage("assistant", confirmMsg);
      messages.push({ role: "assistant", content: confirmMsg });
      if (btn) btn.classList.add("hidden"); // one request is enough
    } else {
      appendMessage("assistant", tr("handoffFailed"));
      if (btn) btn.disabled = false; // let them try again
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

    let captured = false;
    try {
      const res = await fetch(`${API_URL}/api/v1/widget/lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Token": AGENT_TOKEN,
        },
        body: JSON.stringify({ session_id: sessionId, name: name || null, email: email || null, phone: phone || null }),
      });

      // fetch only rejects on network failure, so a 4xx/5xx used to sail through
      // here unnoticed: the visitor saw success and the lead was never stored.
      captured = res.ok;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.warn(`[Foji Widget] Lead capture failed (${res.status}):`, detail.slice(0, 300));
      }
    } catch (err) {
      console.warn("[Foji Widget] Lead capture request failed:", err);
    }

    removeLeadForm();
    // Only remember it as done when it actually was — otherwise a transient
    // failure would silently lose the contact for the rest of the session.
    if (captured) markLeadSubmitted();
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
    heading.textContent = suggestion.title || tr("chooseTime");
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
    nameInput.placeholder = tr("yourName");
    nameInput.autocomplete = "name";

    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.placeholder = tr("yourEmail");
    emailInput.autocomplete = "email";

    const notesInput = document.createElement("input");
    notesInput.type = "text";
    notesInput.placeholder = tr("notes");

    const bookBtn = document.createElement("button");
    bookBtn.className = "foji-book-btn";
    bookBtn.textContent = tr("confirmBooking");

    const msgEl = document.createElement("p");
    msgEl.className = "foji-calendar-msg";

    bookBtn.addEventListener("click", async () => {
      if (!selectedSlot) return;
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      if (!name || !email) {
        msgEl.textContent = tr("fillNameEmail");
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
    if (bookBtn) { bookBtn.disabled = true; bookBtn.textContent = tr("booking"); }

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
        if (msgEl) msgEl.textContent = tr("slotTaken");
        if (bookBtn) { bookBtn.disabled = false; bookBtn.textContent = tr("confirmBooking"); }
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (msgEl) msgEl.textContent = tr("bookingFailed");
        if (bookBtn) { bookBtn.disabled = false; bookBtn.textContent = tr("confirmBooking"); }
        return;
      }

      const data = await res.json();
      cardEl.remove();
      appendMessage("assistant", data.message || tr("bookingConfirmed"));
      scrollToBottom();
    } catch {
      if (msgEl) msgEl.textContent = tr("networkError");
      if (bookBtn) { bookBtn.disabled = false; bookBtn.textContent = tr("confirmBooking"); }
    }
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  async function sendMessage() {
    if (isStreaming) return;
    const input = shadowRoot.getElementById("foji-input");
    const text = input.value.trim();
    const photo = pendingPhoto;
    if (!text && !photo) return; // a photo alone is a message too

    input.value = "";
    input.style.height = "auto";
    setPendingPhoto(null);

    // Remove starters on first user message
    removeStarters();

    appendUserMessage(text, photo && photo.dataUrl);
    messages.push({ role: "user", content: photo ? `[imagem] ${text}`.trim() : text });
    updateHandoffButton(); // may cross the threshold on this turn

    const thinkingEl = appendTypingIndicator();
    setStreaming(true);

    try {
      const reply = await streamChat(text, thinkingEl, photo);
      messages.push({ role: "assistant", content: reply });
    } catch (err) {
      removeElement(thinkingEl);
      const code = err?.code || err?.message;
      appendMessage(
        "assistant",
        code === "timeout" ? tr("timeout")
          : code === "limit" ? tr("limitReached")
          : tr("genericError")
      );
      console.error("[Foji Widget]", err);
    } finally {
      setStreaming(false);
    }
  }

  async function streamChat(userMessage, thinkingEl, photo) {
    const sessionId = getSessionId();
    const payload = {
      agent_token: AGENT_TOKEN,
      session_id: sessionId,   // null on first message — server assigns one
      message: userMessage,
    };
    if (photo) {
      payload.image_base64 = photo.base64;
      payload.image_mime = photo.mime;
    }
    const res = await fetch(`${API_URL}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.detail || `API error ${res.status}`);
      // 402/429: the business's plan is inactive or its monthly limit is used
      // up — not something "try again" will fix, so the visitor is told so.
      err.code = res.status === 429 || res.status === 402 ? "limit" : "http";
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    // Keep the typing dots up until the first token actually arrives. Swapping
    // to an empty bubble here — as soon as the response headers land — left the
    // visitor staring at a blank bubble for the whole model latency, which is
    // precisely the part where they need to see that something is happening.
    let msgEl = null;
    function bubble() {
      if (!msgEl) {
        removeElement(thinkingEl);
        msgEl = appendMessage("assistant", "");
      }
      return msgEl;
    }

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
            bubble().innerHTML = renderMarkdown(fullText);
            scrollToBottom();
          }

          if (parsed.replace_last) {
            fullText = parsed.replace_last;
            bubble().innerHTML = renderMarkdown(fullText);
            scrollToBottom();
          }

          // The server is retrying with another model after a failure partway
          // through; drop the half-answer and show the typing dots again so the
          // new answer isn't appended to the old one.
          if (parsed.reset) {
            fullText = "";
            if (msgEl) { removeElement(msgEl); msgEl = null; }
            thinkingEl = appendTypingIndicator();
          }

          if (parsed.done && parsed.session_id) {
            // Persist the server-assigned session ID for conversation continuity
            setSessionId(parsed.session_id);
          }

          if (parsed.calendar_suggestion && agentInfo?.calendar_enabled) {
            renderCalendarCard(parsed.calendar_suggestion);
          }

          if (parsed.error) {
            // Clear anything still on screen for this reply before the caller
            // shows a friendly error in its place.
            removeElement(thinkingEl);
            if (msgEl && !fullText) removeElement(msgEl);
            const err = new Error(parsed.error);
            err.code = parsed.error; // "timeout" | "unavailable"
            throw err;
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue; // non-JSON data line — skip
          throw e;
        }
      }
    }

    // A stream that produced nothing must still clear the dots.
    removeElement(thinkingEl);

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
    const attach = shadowRoot.getElementById("foji-attach");
    if (attach) attach.disabled = val;
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
