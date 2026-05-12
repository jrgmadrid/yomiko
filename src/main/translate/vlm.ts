// On-hover VLM transcribe+translate via the yomiko-proxy /v1/vision route
// (Cloudflare Worker → OpenRouter → Qwen2.5-VL). Different shape from the
// text translators in this folder: input is a PNG buffer (image crop around
// the hovered line), output is { text, translation } in one call.
//
// Cache key is the caller-supplied Vision first-pass OCR text for the
// hovered line. The PNG itself is a poor key: pixel-different frames of the
// same VN scene (background animation, cursor blink, dithering) hash to
// different bytes even though the visible text is identical. Vision's OCR
// is stable across same-content frames, and the VLM's translation is a
// function of the visible text anyway, so caching by text is both more
// hit-friendly and semantically right.
//
// Errors are logged and surfaced as null — the renderer treats "no result"
// as "no translation available", same as when no proxy is configured. The
// IPC handler in main/index.ts checks for null and silently skips sending
// any payload back to the overlay.

import { app, nativeImage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MAX_CACHE_ENTRIES = 200
// Cap for the longest side. Below ~2k, Qwen still benefits from extra
// resolution on small text (furigana annotations, sidebar panels in
// busy scenes) — losing that detail demonstrably hurts rare-kanji
// transcription. Above this, the model downscales internally anyway, so
// pushing higher just wastes bandwidth and input tokens. The proxy's 8MB
// b64 cap (≈6MB raw PNG) is the floor this has to fit under for retina
// 2560×1440 captures: 2048×1152 PNG hovers around 1-3MB.
const MAX_IMAGE_DIM = 2048
// Bump when the cache file's schema or value shape changes — older files
// with mismatched version are ignored on load, so stale entries from a
// prior code shape can't bleed into the running session.
const CACHE_FORMAT_VERSION = 1

export interface VlmResult {
  text: string
  translation: string
}

interface SettingsShape {
  proxyUrl?: string
  proxyToken?: string
}

interface ProxyCreds {
  baseUrl: string
  token: string
}

interface VisionResponse {
  text?: string
  translation?: string
  error?: string
}

const cache = new Map<string, VlmResult>()
let cacheLoaded = false
// undefined = not yet read, null = absent / disabled, otherwise live creds.
let creds: ProxyCreds | null | undefined = undefined

interface CacheFile {
  version: number
  entries: [string, VlmResult][]
}

function cachePath(): string {
  return resolve(app.getPath('userData'), 'vlm-cache.json')
}

// Lazy load on first call. Survives `npm run dev` restarts so VN scenes
// you revisit don't re-hit the VLM. Insertion order is preserved (the LRU
// hand-rolled atop Map relies on it), so cache recency carries across
// sessions too.
function loadCacheOnce(): void {
  if (cacheLoaded) return
  cacheLoaded = true
  try {
    const text = readFileSync(cachePath(), 'utf8')
    const parsed = JSON.parse(text) as CacheFile
    if (parsed.version !== CACHE_FORMAT_VERSION) {
      console.log(
        `[vlm] cache format v${parsed.version}, expected v${CACHE_FORMAT_VERSION}; starting fresh`
      )
      return
    }
    for (const [k, v] of parsed.entries.slice(-MAX_CACHE_ENTRIES)) {
      cache.set(k, v)
    }
    console.log(`[vlm] loaded ${cache.size} cached translations from disk`)
  } catch {
    // No cache file or unreadable — fine, starting empty.
  }
}

export function persistCache(): void {
  if (!cacheLoaded) return // never loaded, so nothing meaningful to write
  try {
    const payload: CacheFile = {
      version: CACHE_FORMAT_VERSION,
      entries: [...cache.entries()]
    }
    writeFileSync(cachePath(), JSON.stringify(payload))
    console.log(`[vlm] persisted ${payload.entries.length} translations to disk`)
  } catch (err) {
    console.warn(`[vlm] cache persist failed: ${(err as Error).message}`)
  }
}

function readCreds(): ProxyCreds | null {
  if (creds !== undefined) return creds
  let settings: SettingsShape = {}
  try {
    const path = resolve(app.getPath('userData'), 'settings.json')
    settings = JSON.parse(readFileSync(path, 'utf8')) as SettingsShape
  } catch {
    // No settings.json — fall back to env vars only.
  }
  const baseUrl = (process.env.YOMIKO_PROXY_URL ?? settings.proxyUrl ?? '').trim()
  const token = (process.env.YOMIKO_PROXY_TOKEN ?? settings.proxyToken ?? '').trim()
  if (!baseUrl || !token) {
    console.warn(
      '[vlm] no proxy creds (set YOMIKO_PROXY_URL+YOMIKO_PROXY_TOKEN or proxyUrl+proxyToken in settings.json); hover translation disabled'
    )
    creds = null
    return null
  }
  creds = { baseUrl: baseUrl.replace(/\/$/, ''), token }
  console.log(`[vlm] proxy ready (${new URL(creds.baseUrl).host})`)
  return creds
}

function recordHit(key: string): VlmResult | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function recordMiss(key: string, value: VlmResult): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

/**
 * Send a PNG crop to the VLM proxy and return its transcription +
 * translation. `cacheKey` is a stable identifier for "what line is on
 * screen" — typically Vision's first-pass OCR text. Returns null when no
 * proxy is configured, when the upstream call fails, or when the response
 * is malformed. Never throws.
 */
export async function translateRegionImage(
  png: Buffer,
  cacheKey: string
): Promise<VlmResult | null> {
  const c = readCreds()
  if (!c) return null

  loadCacheOnce()
  const cached = recordHit(cacheKey)
  if (cached) {
    console.log(`[vlm] cache hit: ${cacheKey.slice(0, 60)}`)
    return cached
  }

  const sized = downscaleIfLarge(png)
  const imageB64 = sized.toString('base64')

  let res: Response
  try {
    res = await fetch(`${c.baseUrl}/v1/vision`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_b64: imageB64 })
    })
  } catch (err) {
    console.warn(`[vlm] fetch failed: ${(err as Error).message}`)
    return null
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as VisionResponse | null
    console.warn(`[vlm] HTTP ${res.status}: ${body?.error ?? res.statusText}`)
    return null
  }

  let data: VisionResponse
  try {
    data = (await res.json()) as VisionResponse
  } catch {
    console.warn('[vlm] non-JSON response')
    return null
  }
  if (!data.text || !data.translation) {
    console.warn(`[vlm] missing fields: ${JSON.stringify(data).slice(0, 200)}`)
    return null
  }

  const result: VlmResult = { text: data.text, translation: data.translation }
  recordMiss(cacheKey, result)
  return result
}

function downscaleIfLarge(png: Buffer): Buffer {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  const longest = Math.max(width, height)
  if (longest <= MAX_IMAGE_DIM) return png
  const scale = MAX_IMAGE_DIM / longest
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const resized = img.resize({ width: w, height: h, quality: 'good' })
  console.log(`[vlm] downscaled ${width}×${height} → ${w}×${h}`)
  return resized.toPNG()
}
