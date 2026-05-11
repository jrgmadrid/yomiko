# yomiko-proxy

Cloudflare Worker that forwards translation requests from the [yomiko](../README.md) app to DeepSeek. Keeps the maintainer's DeepSeek API key off user devices, so yomiko can ship with translation that works on first launch without anyone needing their own key.

## Architecture

```
yomiko app → POST /translate (Bearer token)
              → CF Worker
                 → DeepSeek chat-completions (maintainer's key)
                 ← translated text
              ← { text, from, to }
```

The Worker constrains the request shape — fixed system prompt, single user line, capped at 2000 chars — so a leaked token can't be turned into a free general-purpose LLM. Backstops layered: (1) shared-token auth at the edge, (2) Cloudflare's per-IP rate limiting, (3) prepay cap on the DeepSeek account itself.

## Deploy

One-time setup:

```bash
cd proxy
npm install
npx wrangler login           # browser auth with your Cloudflare account
npx wrangler secret put DEEPSEEK_API_KEY
#   paste your DeepSeek API key
npx wrangler secret put PROXY_SHARED_TOKEN
#   paste a random secret — generate one with: openssl rand -hex 32
npx wrangler deploy
```

The deploy prints the Worker URL (`https://yomiko-proxy.<your-cf-account>.workers.dev`). The yomiko app reads this URL and the shared token from its own config.

## Local dev

```bash
npx wrangler dev
```

Runs the Worker locally at `http://localhost:8787`. Secrets configured via `wrangler secret put` are available in dev too.

Test request:

```bash
curl -X POST http://localhost:8787/translate \
  -H "Authorization: Bearer $PROXY_SHARED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "おはよう"}'
```

## Logs

```bash
npx wrangler tail
```

Streams live logs from the deployed Worker.
