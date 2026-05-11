// Pluggable machine-translation backend. Mirrors the OcrBackend / TextSource
// pattern: backend implementations are interchangeable; the consumer doesn't
// know which one is wired in. Initial backend is DeepL Free; DeepSeek / a
// yomiko proxy are planned follow-ups.

export interface TranslateOptions {
  /** ISO-639-1 source language. Default 'ja'. */
  from?: string
  /** ISO-639-1 target language. Default 'en'. */
  to?: string
}

export interface TranslateResult {
  text: string
  from: string
  to: string
}

export interface Translator {
  readonly id: string
  translate(text: string, opts?: TranslateOptions): Promise<TranslateResult>
  close(): Promise<void>
}

/**
 * Thrown for non-recoverable backend errors (bad key, unsupported language,
 * provider permanently down). Recoverable errors (rate limit, transient
 * network) should be handled by the backend's own retry/backoff and only
 * surface as a final TranslateError after exhaustion.
 */
export class TranslateError extends Error {
  readonly kind: 'auth' | 'quota' | 'network' | 'bad-input' | 'unknown'
  constructor(kind: TranslateError['kind'], message: string) {
    super(message)
    this.kind = kind
    this.name = 'TranslateError'
  }
}
