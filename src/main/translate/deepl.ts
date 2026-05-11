// DeepL Free / Pro backend.
//
// Free-tier keys end in ':fx' and use api-free.deepl.com; paid keys use
// api.deepl.com. We pick the host from the key suffix at construct time.
//
// Auth header: `Authorization: DeepL-Auth-Key <key>`
// POST form-urlencoded; one `text=` per call (single-line translation matches
// our line-oriented pipeline). source_lang is uppercase ISO-639-1.

import { TranslateError, type Translator, type TranslateOptions, type TranslateResult } from './types'

const FREE_HOST = 'https://api-free.deepl.com'
const PRO_HOST = 'https://api.deepl.com'

interface DeepLResponse {
  translations?: { detected_source_language?: string; text?: string }[]
  message?: string
}

export class DeepLTranslator implements Translator {
  readonly id = 'deepl'
  private readonly host: string

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new TranslateError('auth', 'DeepL API key is empty')
    this.host = apiKey.endsWith(':fx') ? FREE_HOST : PRO_HOST
  }

  async translate(text: string, opts: TranslateOptions = {}): Promise<TranslateResult> {
    const from = (opts.from ?? 'ja').toUpperCase()
    const to = (opts.to ?? 'en').toUpperCase()
    const body = new URLSearchParams({ text, source_lang: from, target_lang: to })

    let res: Response
    try {
      res = await fetch(`${this.host}/v2/translate`, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      })
    } catch (err) {
      throw new TranslateError('network', `DeepL fetch failed: ${(err as Error).message}`)
    }

    if (res.status === 403) throw new TranslateError('auth', 'DeepL rejected the API key (403)')
    if (res.status === 456) throw new TranslateError('quota', 'DeepL quota exhausted (456)')
    if (res.status === 429) throw new TranslateError('quota', 'DeepL rate limited (429)')
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new TranslateError('unknown', `DeepL HTTP ${res.status}: ${detail || res.statusText}`)
    }

    const data = (await res.json()) as DeepLResponse
    const out = data.translations?.[0]?.text
    if (typeof out !== 'string') {
      throw new TranslateError('unknown', `DeepL response missing translation: ${JSON.stringify(data)}`)
    }
    return {
      text: out,
      from: data.translations?.[0]?.detected_source_language?.toLowerCase() ?? from.toLowerCase(),
      to: to.toLowerCase()
    }
  }

  async close(): Promise<void> {
    // No persistent resource to release; HTTP is stateless.
  }
}
