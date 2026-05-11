import { resolve } from 'node:path'
import { app, nativeImage } from 'electron'
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

// VNs render text 2-4× larger than Vision's training distribution (typical
// document/scene text is 12-30px character height; VN text boxes hit 60-80px).
// Out-of-distribution inputs get genuinely misread — empirically: Vision
// returns 信→言 at native scale and 信→信 at 0.5x on the same source frame.
// Pre-downscale lands the input inside Vision's preferred resolution range.
// Override the default via YOMIKO_OCR_SCALE env var (e.g. 0.4 for thicker
// fonts, 0.6 for thinner; 1.0 disables downscale entirely).
const DEFAULT_OCR_SCALE = 0.5
const MIN_DIMENSION = 32

function readOcrScale(): number {
  const raw = process.env.YOMIKO_OCR_SCALE
  if (!raw) return DEFAULT_OCR_SCALE
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 && n <= 4 ? n : DEFAULT_OCR_SCALE
}

function downscalePng(png: Buffer, scale: number): Buffer {
  if (scale === 1) return png
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  const targetW = Math.round(width * scale)
  const targetH = Math.round(height * scale)
  if (targetW < MIN_DIMENSION || targetH < MIN_DIMENSION) return png
  return img.resize({ width: targetW, height: targetH, quality: 'best' }).toPNG()
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
    const sentPng = downscalePng(png, readOcrScale())
    const out = await this.send(lengthPrefixed(sentPng))
    if (out.error) throw new Error(out.error)
    // Vision's bboxes are normalized to whatever image it received; using
    // ORIGINAL width/height here scales them back to original-frame pixel
    // coords automatically, so downstream (hover zones, etc.) sees the
    // same coord system regardless of the downscale ratio.
    const lines = (out.lines ?? []).map((l): OcrLine => {
      const lineRect = normalizedToPixels(l.bbox, width, height)
      return {
        text: l.text,
        rect: lineRect,
        chars: synthesizeCharRects(l.text, lineRect)
      }
    })
    return { lines }
  }
}
