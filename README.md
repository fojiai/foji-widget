# foji-widget

Embeddable chat widget for the Foji platform. Customers add a single script tag to their site to enable AI-powered chat.

## Tech

- Vanilla JavaScript (Shadow DOM for CSS isolation)
- Astro 4 (dev server only, not in production bundle)
- SSE streaming via ReadableStream API
- AWS Amplify Hosting (static)

## Local Development

```bash
npm install
npm run dev
```

Runs on `http://localhost:4321`.

## Embedding

```html
<script src="https://widget.foji.ai/widget.js" data-agent-token="TOKEN" async></script>
```

Optional attributes: `data-api-url`, `data-position`, `data-primary-color`, `data-title`, `data-placeholder`.

## Deploy

- **Dev**: Push to `main` triggers deploy via GitHub Actions to Amplify.
- **Prod**: Manual `workflow_dispatch` with confirmation.
