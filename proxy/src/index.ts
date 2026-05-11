// yomiko-proxy — Cloudflare Worker that forwards translation requests to
// DeepSeek using the maintainer's API key. Keeps the API key off user
// devices and lets yomiko ship with translation that "just works."
//
// Endpoint: POST /translate
//   Headers: Authorization: Bearer <PROXY_SHARED_TOKEN>
//   Body:    { "text": string, "from"?: "ja", "to"?: "en" }
//   Returns: { "text": string, "from": string, "to": string }
//
// Why this isn't a transparent OpenAI passthrough: a passthrough would let
// any client with the token use the maintainer's prepaid credits for
// arbitrary LLM queries (code generation, chat, etc.), not just VN
// translation. Constraining the request shape to a fixed system prompt +
// single user line keeps the spend bounded to the actual product use case.

interface Env {
  DEEPSEEK_API_KEY: string
  PROXY_SHARED_TOKEN: string
}

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-v4-flash'

// Byte-identical across calls so DeepSeek's prompt-prefix cache hits.
// Mirror of yomiko's src/main/translate/deepseek.ts SYSTEM_PROMPT — keep
// these in sync.
const SYSTEM_PROMPT =
  'You are a professional Japanese-to-English translator working on visual novel dialogue. ' +
  'Translate the user message to natural, idiomatic English that preserves tone and register. ' +
  'Output only the translation. No quotes, no commentary, no romanization, no notes.'

interface TranslateRequest {
  text?: unknown
  from?: unknown
  to?: unknown
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method !== 'POST' || url.pathname !== '/translate') {
      return json({ error: 'POST /translate only' }, 404)
    }

    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${env.PROXY_SHARED_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401)
    }

    let body: TranslateRequest
    try {
      body = (await request.json()) as TranslateRequest
    } catch {
      return json({ error: 'bad json' }, 400)
    }

    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) return json({ error: 'empty text' }, 400)
    if (text.length > 2000) return json({ error: 'text too long (>2000 chars)' }, 413)

    const from = typeof body.from === 'string' ? body.from : 'ja'
    const to = typeof body.to === 'string' ? body.to : 'en'

    const upstream = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        stream: false
      })
    })

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      return json({ error: `upstream ${upstream.status}: ${detail.slice(0, 200)}` }, upstream.status)
    }

    const data = (await upstream.json()) as ChatCompletionResponse
    const out = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!out) return json({ error: 'upstream returned empty content' }, 502)

    return json({ text: out, from, to }, 200)
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
