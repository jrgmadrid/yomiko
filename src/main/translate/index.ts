// Translator factory + dedup cache. The consumer (main/index.ts) calls
// `translateLine(text)`; this module owns backend selection, key reading,
// and per-line caching.
//
// Cache: VN dialogue repeats heavily (character names, recurring phrases).
// Bounded to MAX_CACHE_ENTRIES with LRU eviction so memory stays flat.

import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DeepLTranslator } from './deepl'
import { DeepSeekTranslator } from './deepseek'
import { TranslateError, type Translator, type TranslateResult } from './types'

const MAX_CACHE_ENTRIES = 1000

interface SettingsShape {
  deepSeekApiKey?: string
  deepLApiKey?: string
}

let translator: Translator | null = null
let initFailed = false

const cache = new Map<string, TranslateResult>()

interface BackendChoice {
  build: (key: string) => Translator
  key: string
  label: string
}

// Precedence: DeepSeek first (cheap, sustained-use friendly, no quota
// cliff), DeepL second (BYOK option for users with a Pro key from other
// contexts). Whichever key is present wins; both unset = translation
// disabled.
function pickBackend(): BackendChoice | null {
  const settings = readSettings()
  const dsKey = (process.env.DEEPSEEK_API_KEY ?? settings.deepSeekApiKey ?? '').trim()
  if (dsKey) {
    return { build: (k) => new DeepSeekTranslator(k), key: dsKey, label: 'DeepSeek' }
  }
  const dlKey = (process.env.DEEPL_API_KEY ?? settings.deepLApiKey ?? '').trim()
  if (dlKey) {
    return { build: (k) => new DeepLTranslator(k), key: dlKey, label: 'DeepL' }
  }
  return null
}

function readSettings(): SettingsShape {
  try {
    const path = resolve(app.getPath('userData'), 'settings.json')
    return JSON.parse(readFileSync(path, 'utf8')) as SettingsShape
  } catch {
    return {}
  }
}

function getTranslator(): Translator | null {
  if (translator) return translator
  if (initFailed) return null
  const choice = pickBackend()
  if (!choice) {
    console.warn(
      '[translate] no API key (set DEEPSEEK_API_KEY, DEEPL_API_KEY, or the equivalents in userData/settings.json); translation disabled'
    )
    initFailed = true
    return null
  }
  try {
    translator = choice.build(choice.key)
    console.log(`[translate] ${choice.label} backend ready`)
    return translator
  } catch (err) {
    console.error('[translate] backend init failed:', (err as Error).message)
    initFailed = true
    return null
  }
}

function cacheKey(text: string, from: string, to: string): string {
  return `${from}|${to}|${text}`
}

function recordHit(key: string): TranslateResult | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  // Touch for LRU: re-insert to move to end of insertion order.
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function recordMiss(key: string, value: TranslateResult): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

/**
 * Translates a single line. Returns null when no backend is configured (not
 * an error — just means translation is disabled in this session). Throws
 * TranslateError on real failure.
 */
export async function translateLine(text: string): Promise<TranslateResult | null> {
  const t = getTranslator()
  if (!t) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  const from = 'ja'
  const to = 'en'
  const key = cacheKey(trimmed, from, to)
  const cached = recordHit(key)
  if (cached) return cached
  try {
    const result = await t.translate(trimmed, { from, to })
    recordMiss(key, result)
    return result
  } catch (err) {
    if (err instanceof TranslateError) {
      console.warn(`[translate] ${err.kind}: ${err.message}`)
      // For auth/quota errors, disable subsequent calls so we don't hammer
      // the API for every line. User must restart after fixing.
      if (err.kind === 'auth' || err.kind === 'quota') {
        initFailed = true
        translator = null
      }
    } else {
      console.error('[translate] unexpected:', err)
    }
    return null
  }
}

export async function closeTranslator(): Promise<void> {
  if (translator) {
    await translator.close()
    translator = null
  }
}

export type { TranslateResult } from './types'
