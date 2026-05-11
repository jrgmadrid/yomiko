// Hosted-proxy backend. Points at the yomiko-proxy Cloudflare Worker
// (proxy/ in this repo) which holds the actual DeepSeek key on the server
// side, so user installs don't need to provision a key themselves.
//
// Wire shape matches proxy/src/index.ts exactly:
//   POST <baseUrl>/translate
//   Headers: Authorization: Bearer <token>, Content-Type: application/json
//   Body:    { text: string, from?: string, to?: string }
//   Returns: { text: string, from: string, to: string }   on 200
//            { error: string }                            on non-200

import { TranslateError, type Translator, type TranslateOptions, type TranslateResult } from './types'

interface ProxyResponse {
  text?: string
  from?: string
  to?: string
  error?: string
}

export class ProxyTranslator implements Translator {
  readonly id = 'proxy'

  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {
    if (!baseUrl) throw new TranslateError('auth', 'proxy URL is empty')
    if (!token) throw new TranslateError('auth', 'proxy token is empty')
  }

  async translate(text: string, opts: TranslateOptions = {}): Promise<TranslateResult> {
    const from = opts.from ?? 'ja'
    const to = opts.to ?? 'en'

    let res: Response
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/translate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text, from, to })
      })
    } catch (err) {
      throw new TranslateError('network', `proxy fetch failed: ${(err as Error).message}`)
    }

    if (res.status === 401) throw new TranslateError('auth', 'proxy rejected the token (401)')
    if (res.status === 402) throw new TranslateError('quota', 'proxy upstream out of credits (402)')
    if (res.status === 429) throw new TranslateError('quota', 'proxy rate limited (429)')
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ProxyResponse | null
      const detail = body?.error ?? res.statusText
      throw new TranslateError('unknown', `proxy HTTP ${res.status}: ${detail}`)
    }

    const data = (await res.json()) as ProxyResponse
    if (!data.text) {
      throw new TranslateError('unknown', `proxy response missing text: ${JSON.stringify(data)}`)
    }
    return { text: data.text, from: data.from ?? from, to: data.to ?? to }
  }

  async close(): Promise<void> {
    // Stateless HTTP; nothing to release.
  }
}
