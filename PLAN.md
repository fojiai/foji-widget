# foji-widget — Plan

## Role in the Foji AI Ecosystem

`foji-widget` is the **embeddable chat interface** for Foji AI. It is an Astro site that renders a React chat component, designed to be dropped into any website as an `<iframe>`. End-users interact with agents here — no login required. All configuration is passed via URL parameters.

---

## Tech Stack

- **Astro 5** — Island architecture (minimal JS sent to browser)
- **React 19** — Only for the interactive `ChatForm` component
- **Tailwind CSS 4** — Styling
- **shadcn/ui subset** — Button, Textarea, Card, Badge (matching foji-ui palette)

---

## Architecture

```
src/
├── pages/
│   └── index.astro              # Entry point — renders ChatForm as a React island
├── components/
│   ├── ChatForm.tsx             # Main interactive chat UI (React client:load)
│   ├── WelcomeScreen.tsx        # Agent intro shown before first message
│   └── ui/                      # shadcn/ui primitives (Button, Textarea, etc.)
├── lib/
│   ├── api-client.ts            # Fetch with retry + timeout (same pattern as tutoria-widget)
│   └── utils.ts
├── styles/
│   └── global.css               # Brand colors as CSS vars
└── layouts/
    └── Layout.astro             # Minimal HTML shell
```

---

## URL Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `agent_token` | Yes | — | 64-char token from FojiApi |
| `dark` | No | `auto` | `auto` \| `true` \| `false` |
| `lang` | No | `pt-br` | `pt-br` \| `en` \| `es` |
| `primaryColor` | No | `#FF2D2D` | Override brand color (hex) |
| `streaming` | No | `true` | Enable SSE streaming |

---

## Key Components

### `ChatForm.tsx`
- Fetches agent info on mount (`GET /api/v1/widget/agent-info?token=`)
- Shows `WelcomeScreen` with agent name, industry badge, description, motto
- Sends messages to `POST /api/v1/chat` (SSE)
- Renders streamed chunks progressively
- Message history stored in component state (session only)
- Session ID: generated `uuid` on first message, persisted in `sessionStorage`

### `WelcomeScreen.tsx`
- Agent name + industry icon (scales icon for: accounting, law, gear for internal)
- Description text
- Motto in selected language:
  - pt-br: "Forje sua inteligência"
  - en: "Forge your intelligence"
  - es: "Forja tu inteligencia"

### API Client (`lib/api-client.ts`)
- Same proven pattern as `tutoria-widget`:
  - Retry up to 3× with exponential backoff (1s → 2s → 4s + jitter)
  - 60s timeout for chat, 15s for metadata
  - Retryable status codes: 408, 429, 500, 502, 503, 504
  - SSE via `EventSource` or `fetch` + `ReadableStream`

---

## Embedding

```html
<iframe
  src="https://widget.foji.ai/?agent_token=YOUR_TOKEN&dark=auto&lang=pt-br"
  width="100%"
  height="600px"
  style="border: none; border-radius: 8px;">
</iframe>
```

Embed code is generated automatically in `foji-ui` (agent detail page → "Embed" tab).

---

## Brand & Styling

- CSS variables on `:root`:
  ```css
  --color-primary:   #FF2D2D;
  --color-secondary: #FF5A1F;
  --color-accent:    #FFB300;
  ```
- Dark mode: toggled via `.dark` class on `<html>`, set from `dark` URL param
- `primaryColor` URL param overrides `--color-primary` for white-label use

---

## No Auth, No Quiz, No Verification Gate

Simpler than `tutoria-widget` — no student verification, no LGPD gate, no quiz modal.
The only gate is a valid `agent_token`.

---

## Environment Variables

```
PUBLIC_FOJI_API_URL            # https://api.foji.ai (the foji-ai-api base URL)
PUBLIC_ENABLE_STREAMING        # true (default)
```

---

## Deploy Target

**Vercel** — static Astro site with edge deployment.
- Dev: auto-deploy on push to `main` → Vercel preview URL
- Prod: `workflow_dispatch` → Vercel production

---

## Connections to Other Services

| Service | How |
|---------|-----|
| `foji-ai-api` | `POST /api/v1/chat` for streaming responses; `GET /api/v1/widget/agent-info` |
| `foji-ui` | Generates embed code that points here |
