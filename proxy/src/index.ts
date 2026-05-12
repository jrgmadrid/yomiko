// yomiko-proxy — Cloudflare Worker that fronts upstream translation APIs
// with the maintainer's keys, so user installs don't need to provision
// keys themselves.
//
// Routes:
//   POST /translate   — DeepSeek text translation (Ship 2)
//     Body:    { text: string, from?: "ja", to?: "en" }
//     Returns: { text: string, from: string, to: string }
//
//   POST /v1/vision   — Qwen2.5-VL transcribe+translate from image (Ship 2.8)
//     Body:    { image_b64: string }   // raw base64, no data: prefix
//     Returns: { text: string, translation: string }
//
// Both routes use Authorization: Bearer <PROXY_SHARED_TOKEN>. The shape is
// constrained so a stolen client token can only burn credits on VN
// translation, not arbitrary LLM queries against the maintainer's keys.

interface Env {
  DEEPSEEK_API_KEY: string
  OPENROUTER_API_KEY: string
  PROXY_SHARED_TOKEN: string
}

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const VISION_MODEL = 'qwen/qwen2.5-vl-72b-instruct'

// Byte-identical across calls so DeepSeek's prompt-prefix cache hits.
// Mirror of yomiko's src/main/translate/deepseek.ts SYSTEM_PROMPT — keep
// these in sync.
const TRANSLATE_SYSTEM_PROMPT =
  'You are a professional Japanese-to-English translator working on visual novel dialogue. ' +
  'Translate the user message to natural, idiomatic English that preserves tone and register. ' +
  'Output only the translation. No quotes, no commentary, no romanization, no notes.'

// Vision prompt: transcribe-faithfully, then translate. Each clause defends
// against a specific empirical failure: common-kanji substitution (唵 → 俺),
// canonical-form normalization (摩利支曳 → 摩利支天), trailing-mark omission
// (ー dropped), vertical-bracket misread (」 → こ), mantra mistranslation
// (Sanskrit form when Japanese-reading is what's spoken in-scene).
const VISION_SYSTEM_PROMPT =
  'You are a professional Japanese-to-English translator for visual novel dialogue. ' +
  'Given an image, identify the longest contiguous Japanese sentence or text panel, ' +
  'transcribe it character-faithfully, then translate it. ' +
  'Transcription: do not substitute visually-similar common kanji for rare ones; ' +
  'do not normalize archaic, liturgical, or unusual spellings to canonical forms. ' +
  'Use furigana annotations to confirm kanji identity (furigana "おん" indicates 唵, not 俺). ' +
  'Preserve all visible punctuation including trailing marks (ー、…、——、？、！). ' +
  'Japanese corner brackets (「」『』) rotate in vertical text and resemble hiragana ' +
  '(」 ≈ こ, 「 ≈ し); identify them by their structural role at sentence boundaries. ' +
  'Render genuinely unreadable characters as "？" rather than guessing. ' +
  'Translation: natural, idiomatic English preserving tone and register. ' +
  'For Buddhist mantras or liturgical text chanted by a Japanese character, use the ' +
  'Japanese-reading romanization (e.g., "On Marishi-ten Sowaka—", not "Om Marichi Svaha") — ' +
  'the JP reading is what is sonically performed. Hyphenate compound deity names. ' +
  'Ignore window chrome, menu buttons, and UI labels. ' +
  'Respond with one JSON object: {"text":"<japanese>","translation":"<english>"}. ' +
  'No markdown, no code fences, no commentary.'

const VISION_USER_PROMPT = 'Transcribe and translate the Japanese text in this image.'

// ~8MB base64 ≈ 6MB raw PNG. Clients are expected to downscale full-frame
// captures to ~1600px max dim before sending, which lands well under this;
// the ceiling is an abuse guard, not a typical case.
const MAX_IMAGE_B64_LEN = 8 * 1024 * 1024

interface TranslateRequest {
  text?: unknown
  from?: unknown
  to?: unknown
}

interface VisionRequest {
  image_b64?: unknown
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405)
    }

    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${env.PROXY_SHARED_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401)
    }

    if (url.pathname === '/translate') return handleTranslate(request, env)
    if (url.pathname === '/v1/vision') return handleVision(request, env)
    return json({ error: 'unknown route' }, 404)
  }
}

async function handleTranslate(request: Request, env: Env): Promise<Response> {
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
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
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

async function handleVision(request: Request, env: Env): Promise<Response> {
  let body: VisionRequest
  try {
    body = (await request.json()) as VisionRequest
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  const imageB64 = typeof body.image_b64 === 'string' ? body.image_b64 : ''
  if (!imageB64) return json({ error: 'empty image_b64' }, 400)
  if (imageB64.length > MAX_IMAGE_B64_LEN) {
    return json({ error: `image_b64 too large (>${MAX_IMAGE_B64_LEN} chars)` }, 413)
  }

  const upstream = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      // OpenRouter rankings/attribution; not required, harmless to send.
      'HTTP-Referer': 'https://github.com/jrgmadrid/yomiko',
      'X-Title': 'yomiko'
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_USER_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageB64}` } }
          ]
        }
      ],
      temperature: 0.2,
      stream: false,
      response_format: { type: 'json_object' }
    })
  })

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
    return json({ error: `upstream ${upstream.status}: ${detail.slice(0, 200)}` }, upstream.status)
  }

  const data = (await upstream.json()) as ChatCompletionResponse
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!raw) return json({ error: 'upstream returned empty content' }, 502)

  const parsed = parseVisionJson(raw)
  if (!parsed) {
    return json({ error: `upstream returned non-JSON: ${raw.slice(0, 200)}` }, 502)
  }
  return json({ text: parsed.text, translation: parsed.translation }, 200)
}

// Strips a ```json ... ``` fence if the model emitted one despite the
// response_format hint, then parses. Returns null on any failure or missing
// fields.
function parseVisionJson(raw: string): { text: string; translation: string } | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? raw).trim()
  let obj: unknown
  try {
    obj = JSON.parse(candidate)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const text = typeof o.text === 'string' ? o.text.trim() : ''
  const translation = typeof o.translation === 'string' ? o.translation.trim() : ''
  if (!text || !translation) return null
  return { text, translation }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
