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

import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MAX_CACHE_ENTRIES = 200

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
// undefined = not yet read, null = absent / disabled, otherwise live creds.
let creds: ProxyCreds | null | undefined = undefined

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

  const cached = recordHit(cacheKey)
  if (cached) {
    console.log(`[vlm] cache hit: ${cacheKey.slice(0, 60)}`)
    return cached
  }

  const imageB64 = png.toString('base64')

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
