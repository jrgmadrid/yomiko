import { screen } from 'electron'
import { Channels, type SharedRegion } from '@shared/ipc'
import { buildHoverZones, hoverPayload } from './ocr/hover-zones'
import type { OcrResult } from './ocr/types'
import type { FrameOcrData } from './sources/types'
import {
  clearFrameLatch,
  getLastHoverPayload,
  latchFrame,
  setLastHoverPayload
} from './frame-latch'
import { getActiveSourceWindowId, lookupActiveWindowState } from './source-window'
import { overlayWindow, sendToOverlay } from './window'

// Hover-zone emit. The two callers differ only in how they discover the
// capture origin (where the captured image lives in screen DIPs):
//   - Test VN: BrowserWindow.getContentBounds() — capturePage returns the
//     content area, not the framed window, so this matches.
//   - Real third-party windows: macos-window-info sidecar (kCGWindowBounds).
//     SCK captures the full framed window and CG bounds match it.
// Win parity will add a third branch (windows-window-info via DwmGetWindowAttribute).
//
// Stashes the (frameId, png, result, region) tuple in the frame latch so the
// translateRegion / submitToAnki IPC handlers can crop the PNG by line bbox
// without re-capturing or re-running OCR.
export async function emitHoverZonesFor(
  label: 'test-vn' | 'real-window',
  result: OcrResult,
  region: SharedRegion,
  captureOrigin: { x: number; y: number },
  png: Buffer
): Promise<void> {
  const overlay = overlayWindow()
  if (!overlay) return
  const frameId = latchFrame(png, result, region)
  const overlayBounds = overlay.getContentBounds()
  const display = screen.getDisplayMatching({
    x: captureOrigin.x,
    y: captureOrigin.y,
    width: region.w,
    height: region.h
  })
  const build = await buildHoverZones(result, {
    region,
    captureOrigin,
    overlayOrigin: { x: overlayBounds.x, y: overlayBounds.y },
    scaleFactor: display.scaleFactor
  })
  const payload = hoverPayload(result, build, frameId)
  console.log(
    `[${label}] hover zones: ${build.zones.length} tokens, ${build.debugChars.length} chars (frame ${payload.frameId})`
  )
  setLastHoverPayload(payload)
  sendToOverlay(Channels.hoverZones, payload)
}

export async function emitRealWindowHoverZones(data: FrameOcrData): Promise<void> {
  const windowId = getActiveSourceWindowId()
  if (windowId === null) return
  let state
  try {
    state = await lookupActiveWindowState()
  } catch (err) {
    console.error('[real-window] window-info lookup failed:', (err as Error).message)
    return
  }
  if (!state) {
    console.log(`[real-window] window ${windowId} not on-screen`)
    return
  }
  await emitHoverZonesFor('real-window', data.result, data.region, state.bounds, data.png)
}

/** Replay the latched payload on renderer request (overlay mount,
 *  hover-mode-on) — static-window targets won't re-OCR, so without this a
 *  remount strands the renderer with empty zone state. */
export function resyncHoverZones(): void {
  const payload = getLastHoverPayload()
  if (!payload) return
  console.log(`[hover-resync] re-emitting frame ${payload.frameId}`)
  sendToOverlay(Channels.hoverZones, payload)
}

/** Atomic reset on source switch / capture stop: drop the latch AND blank
 *  the renderer's zones, so zones from the previous source can't trigger
 *  translate/mine against the old frame. */
export function clearHoverZones(): void {
  clearFrameLatch()
  sendToOverlay(Channels.hoverZones, { frameId: 0, lineText: '', zones: [], debugChars: [] })
}
