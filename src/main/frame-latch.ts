import { nativeImage } from 'electron'
import { isVerticalRect } from '@shared/geometry'
import type { HoverZonePayload, SharedRegion } from '@shared/ipc'
import type { OcrLine, OcrRect, OcrResult } from './ocr/types'

// Latest-frame latch shared by both capture paths. Hover-driven VLM
// translation and Anki mining crop from this PNG using the line bbox
// indexed by the renderer's request. Stale requests (older frame than the
// current latch) are dropped — the renderer has already moved on by the
// time the IPC arrives.
export interface LatestFrame {
  frameId: number
  png: Buffer
  result: OcrResult
  region: SharedRegion
}

let frameCounter = 0
let latestFrame: LatestFrame | null = null
// Most recent HoverZonePayload built for the active source. Replayed on
// renderer-initiated resync (overlay mount, hover-mode-on) so static-window
// targets — where OCR's stabilizer fires once and never again — don't
// strand the renderer with empty zone state across mode toggles or
// dev-reload remounts.
let lastHoverPayload: HoverZonePayload | null = null

/** Stash a new frame and return its monotonic frameId. */
export function latchFrame(png: Buffer, result: OcrResult, region: SharedRegion): number {
  const frameId = ++frameCounter
  latestFrame = { frameId, png, result, region }
  return frameId
}

export function getLatestFrame(): LatestFrame | null {
  return latestFrame
}

export function setLastHoverPayload(payload: HoverZonePayload): void {
  lastHoverPayload = payload
}

export function getLastHoverPayload(): HoverZonePayload | null {
  return lastHoverPayload
}

/** Drop both the frame and the hover payload together — they describe the
 *  same source, so clearing one without the other leaves a window where a
 *  stale hover can crop (and bill) against the previous source's image. */
export function clearFrameLatch(): void {
  latestFrame = null
  lastHoverPayload = null
}

// Crop the source PNG around a single OCR'd line, with generous padding
// perpendicular to the writing axis so the VLM sees wrapped continuations.
// Horizontal text wraps to the line below → vertical pad; vertical text
// wraps to the column beside → horizontal pad. The orientation flips which
// axis gets the wrap-pad and which gets the slop-pad.
export function cropAroundLine(png: Buffer, rect: OcrRect): Buffer | null {
  const img = nativeImage.createFromBuffer(png)
  const { width: imgW, height: imgH } = img.getSize()
  const isVertical = isVerticalRect(rect)
  const thickness = isVertical ? rect.w : rect.h
  const wrapPad = Math.round(thickness * 0.75)
  const slopPad = Math.round(thickness * 0.2)
  const xPad = isVertical ? wrapPad : slopPad
  const yPad = isVertical ? slopPad : wrapPad
  const x = Math.max(0, Math.floor(rect.x - xPad))
  const y = Math.max(0, Math.floor(rect.y - yPad))
  const w = Math.min(imgW - x, Math.ceil(rect.w + xPad * 2))
  const h = Math.min(imgH - y, Math.ceil(rect.h + yPad * 2))
  const cropped = img.crop({ x, y, width: w, height: h })
  return cropped.isEmpty() ? null : cropped.toPNG()
}

export type LatchedLineResult =
  | { ok: true; frame: LatestFrame; line: OcrLine; crop: Buffer }
  | { ok: false; error: 'STALE_FRAME' | 'NO_TARGET'; message: string }

/** Validate a renderer (frameId, lineIdx) request against the latch and
 *  crop the line's surroundings. Shared preamble of the translate-region
 *  and mining handlers. */
export function resolveLatchedLine(frameId: number, lineIdx: number): LatchedLineResult {
  const frame = latestFrame
  if (!frame || frame.frameId !== frameId) {
    return {
      ok: false,
      error: 'STALE_FRAME',
      message: `stale frameId ${frameId} (current ${frame?.frameId ?? 'none'})`
    }
  }
  const line = frame.result.lines[lineIdx]
  if (!line) {
    return { ok: false, error: 'NO_TARGET', message: `no line ${lineIdx} in frame ${frameId}` }
  }
  const crop = cropAroundLine(frame.png, line.rect)
  if (!crop) {
    return { ok: false, error: 'NO_TARGET', message: `crop empty for line ${lineIdx}` }
  }
  return { ok: true, frame, line, crop }
}
