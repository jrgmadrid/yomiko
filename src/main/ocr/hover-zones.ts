import { tokenize } from '../tokenize/tokenizer'
import { groupTokens } from '../tokenize/grouping'
import type { OcrResult } from './types'
import type {
  HoverDebugChar,
  HoverZone,
  HoverZonePayload,
  SharedRegion,
  SharedScreenRect,
  SharedWordGroup
} from '@shared/ipc'

// Hiragana, katakana, CJK ideographs (incl. extension A and compat).
// JMdict has no English/Latin/digit entries, so skipping non-CJK strings
// avoids emitting zones whose popup would be empty.
const CJK_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/
function hasJapanese(s: string): boolean {
  return CJK_REGEX.test(s)
}

function unionRect(rects: SharedScreenRect[]): SharedScreenRect | null {
  let union: SharedScreenRect | null = null
  for (const r of rects) {
    if (r.w <= 0 || r.h <= 0) continue
    if (!union) {
      union = { ...r }
      continue
    }
    const minX = Math.min(union.x, r.x)
    const minY = Math.min(union.y, r.y)
    const maxX = Math.max(union.x + union.w, r.x + r.w)
    const maxY = Math.max(union.y + union.h, r.y + r.h)
    union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  return union
}

/**
 * Capture-origin describes where the OCR'd image lives in screen coords. For
 * the test-VN path it's the BrowserWindow's content bounds; for real
 * third-party windows it's the CG window's kCGWindowBounds. Coordinate
 * transform applied to every char rect:
 *
 *   image-px → (+region) → full-capture px → (÷sf) → window DIPs
 *     → (+capture origin) → screen DIPs → (−overlay origin) → overlay CSS px
 */
export interface HoverZoneContext {
  region: SharedRegion
  captureOrigin: { x: number; y: number }
  overlayOrigin: { x: number; y: number }
  scaleFactor: number
}

export interface HoverZoneBuild {
  zones: HoverZone[]
  debugChars: HoverDebugChar[]
}

export async function buildHoverZones(
  result: OcrResult,
  ctx: HoverZoneContext
): Promise<HoverZoneBuild> {
  const { region, captureOrigin, overlayOrigin, scaleFactor: sf } = ctx

  function toCss(rect: { x: number; y: number; w: number; h: number }): SharedScreenRect {
    return {
      x: (rect.x + region.x) / sf + captureOrigin.x - overlayOrigin.x,
      y: (rect.y + region.y) / sf + captureOrigin.y - overlayOrigin.y,
      w: rect.w / sf,
      h: rect.h / sf
    }
  }

  const debugChars: HoverDebugChar[] = []
  const zones: HoverZone[] = []
  let zoneId = 0

  for (const line of result.lines) {
    if (line.chars.length === 0) continue
    if (!hasJapanese(line.text)) continue

    const cssRects = line.chars.map((c) => toCss(c.rect))
    for (let i = 0; i < line.chars.length; i++) {
      const r = cssRects[i]
      const c = line.chars[i]
      if (r && c) debugChars.push({ text: c.text, rect: r })
    }

    let groups: SharedWordGroup[]
    try {
      const tokens = await tokenize(line.text)
      groups = groupTokens(tokens) as unknown as SharedWordGroup[]
    } catch (err) {
      console.error('[hover-zones] tokenize failed:', (err as Error).message)
      continue
    }

    for (const g of groups) {
      if (g.headPos === '記号' || g.headPos === 'BOS/EOS') continue
      if (!hasJapanese(g.surface)) continue
      const start = Math.max(0, g.start)
      const end = Math.min(line.chars.length, g.end)
      if (end <= start) continue

      const union = unionRect(cssRects.slice(start, end))
      if (!union) continue

      zones.push({
        id: zoneId++,
        surface: g.surface,
        start: g.start,
        end: g.end,
        rect: union,
        group: g
      })
    }
  }

  return { zones, debugChars }
}

export function hoverPayload(
  result: OcrResult,
  build: HoverZoneBuild,
  frameId: number
): HoverZonePayload {
  return {
    frameId,
    lineText: result.lines.map((l) => l.text).join('\n'),
    zones: build.zones,
    debugChars: build.debugChars
  }
}
