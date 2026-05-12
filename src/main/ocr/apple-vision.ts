import { resolve } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { JsonLineSidecar, lengthPrefixed } from './sidecar'
import type { OcrBackend, OcrCharBox, OcrLine, OcrRect, OcrResult } from './types'

interface SidecarLineOut {
  text: string
  bbox: [number, number, number, number]
}

interface SidecarOutput {
  lines?: SidecarLineOut[]
  error?: string
}

// .accurate is the only Vision recognitionLevel that produces results for
// Japanese — but boundingBox(for: Range) collapses every char in a "word" to
// the same line-level rect. Japanese has no spaces, so per-character rects
// from Vision are useless. We synthesize them by dividing the line bbox
// horizontally by character count. CJK fonts are near-monospace, so alignment
// is tight enough for hover hit zones.
function synthesizeCharRects(text: string, lineRect: OcrRect): OcrCharBox[] {
  const chars = [...text]
  if (chars.length === 0) return []
  const charW = lineRect.w / chars.length
  return chars.map((c, i) => ({
    text: c,
    rect: { x: lineRect.x + i * charW, y: lineRect.y, w: charW, h: lineRect.h }
  }))
}

// PNG IHDR width is at byte 16, height at byte 20 (both big-endian u32).
function pngDimensions(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// Vision normalized rect (0–1, bottom-left origin) → image-pixel rect (top-left origin).
function normalizedToPixels(
  bbox: [number, number, number, number],
  imgW: number,
  imgH: number
): OcrRect {
  const [nx, ny, nw, nh] = bbox
  const w = nw * imgW
  const h = nh * imgH
  return { x: nx * imgW, y: imgH - ny * imgH - h, w, h }
}

function binPath(): string {
  const root = is.dev ? app.getAppPath() : process.resourcesPath
  return resolve(root, is.dev ? 'resources/bin/macos-vision-ocr' : 'bin/macos-vision-ocr')
}

export class AppleVisionBackend
  extends JsonLineSidecar<SidecarOutput>
  implements OcrBackend
{
  readonly id = 'apple-vision'

  constructor() {
    super({ label: 'apple-vision', binPath })
  }

  protected parseResponse(json: unknown): SidecarOutput {
    return json as SidecarOutput
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    const { width, height } = pngDimensions(png)
    const out = await this.send(lengthPrefixed(png))
    if (out.error) throw new Error(out.error)
    const lines = (out.lines ?? []).map((l): OcrLine => {
      const lineRect = normalizedToPixels(l.bbox, width, height)
      return {
        text: l.text,
        rect: lineRect,
        chars: synthesizeCharRects(l.text, lineRect)
      }
    })
    return { lines, imageWidth: width, imageHeight: height }
  }
}
