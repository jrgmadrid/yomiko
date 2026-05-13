// Thin AnkiConnect HTTP wrapper. The protocol is a single JSON-POST endpoint
// (no path routing) that dispatches by `action`. Spec:
// https://foosoft.net/projects/anki-connect/
//
// Errors classify into three buckets so the mining hotkey can surface them
// distinctly to the user:
//   - AnkiUnreachableError: AnkiConnect isn't running (Anki not open, addon
//     missing, or wrong port). Network-level — no HTTP response.
//   - AnkiDuplicateError: AnkiConnect-level duplicate-rejection. addNote
//     returns { error: "cannot create note because it is a duplicate" } or
//     similar. Parsed from the `error` field of an HTTP-200 response.
//   - AnkiError: anything else (deck/model not found, bad field, etc).
//
// No retries — AnkiConnect is loopback, so transient failures don't happen.

interface AnkiResponse<T> {
  result: T | null
  error: string | null
}

export class AnkiUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnkiUnreachableError'
  }
}

export class AnkiDuplicateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnkiDuplicateError'
  }
}

export class AnkiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnkiError'
  }
}

export async function ankiRequest<T>(
  action: string,
  params: object,
  url: string,
  timeoutMs = 10_000
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    throw new AnkiUnreachableError(`${action} fetch failed: ${(err as Error).message}`)
  }
  clearTimeout(timer)

  if (!res.ok) {
    throw new AnkiError(`${action} HTTP ${res.status} ${res.statusText}`)
  }

  let body: AnkiResponse<T>
  try {
    body = (await res.json()) as AnkiResponse<T>
  } catch {
    throw new AnkiError(`${action} returned non-JSON response`)
  }

  if (body.error) {
    if (/duplicate/i.test(body.error)) {
      throw new AnkiDuplicateError(body.error)
    }
    throw new AnkiError(`${action}: ${body.error}`)
  }
  return body.result as T
}

export async function ankiVersion(url: string): Promise<number> {
  return ankiRequest<number>('version', {}, url, 1500)
}

export interface StoreMediaParams {
  filename: string
  /** base64-encoded file content */
  data: string
}

export async function storeMediaFile(params: StoreMediaParams, url: string): Promise<string> {
  return ankiRequest<string>('storeMediaFile', params, url)
}

/** addNote payload as accepted by AnkiConnect v6. */
export interface AddNotePayload {
  note: {
    deckName: string
    modelName: string
    fields: Record<string, string>
    tags: string[]
    options?: { allowDuplicate?: boolean }
  }
}

export async function addNote(payload: AddNotePayload, url: string): Promise<number> {
  return ankiRequest<number>('addNote', payload, url)
}
