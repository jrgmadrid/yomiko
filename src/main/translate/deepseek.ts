// DeepSeek backend via the OpenAI-compatible chat-completions endpoint.
//
// Model: deepseek-v4-flash (replaces the deprecated deepseek-chat alias).
// Auth: Bearer token. Endpoint: https://api.deepseek.com/chat/completions.
//
// Why this is the OpenAI-compatible shape rather than DeepSeek's native API:
// the prompt-prefix cache discount on this provider is significant
// (~50× cheaper input on cache hit), and that discount activates on a
// byte-identical leading prefix. Keeping the system prompt fixed across
// every call is what makes the unit economics work — see SYSTEM_PROMPT.
//
// The same chat-completions shape later powers OpenAI / Claude / Anthropic
// or any OpenAI-API-compatible endpoint via a thin variant of this file.

import { TranslateError, type Translator, type TranslateOptions, type TranslateResult } from './types'

const ENDPOINT = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-v4-flash'

// Kept byte-identical across calls so the provider's prompt-prefix cache
// hits. Any tweak here invalidates the cache for every subsequent call —
// don't change casually.
const SYSTEM_PROMPT =
  'You are a professional Japanese-to-English translator working on visual novel dialogue. ' +
  'Translate the user message to natural, idiomatic English that preserves tone and register. ' +
  'Output only the translation. No quotes, no commentary, no romanization, no notes.'

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

export class DeepSeekTranslator implements Translator {
  readonly id = 'deepseek'

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new TranslateError('auth', 'DeepSeek API key is empty')
  }

  async translate(text: string, opts: TranslateOptions = {}): Promise<TranslateResult> {
    const from = opts.from ?? 'ja'
    const to = opts.to ?? 'en'

    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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
    } catch (err) {
      throw new TranslateError('network', `DeepSeek fetch failed: ${(err as Error).message}`)
    }

    if (res.status === 401) throw new TranslateError('auth', 'DeepSeek rejected the API key (401)')
    if (res.status === 402) throw new TranslateError('quota', 'DeepSeek account has insufficient balance (402)')
    if (res.status === 429) throw new TranslateError('quota', 'DeepSeek rate limited (429)')
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new TranslateError('unknown', `DeepSeek HTTP ${res.status}: ${detail || res.statusText}`)
    }

    const data = (await res.json()) as ChatCompletionResponse
    const out = data.choices?.[0]?.message?.content?.trim()
    if (!out) {
      throw new TranslateError('unknown', `DeepSeek response missing content: ${JSON.stringify(data)}`)
    }
    return { text: out, from, to }
  }

  async close(): Promise<void> {
    // Stateless HTTP; nothing to release.
  }
}
