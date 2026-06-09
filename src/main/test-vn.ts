import { BrowserWindow } from 'electron'
import { Channels, type SharedRegion } from '@shared/ipc'
import { getPendingSource } from './capture/stream'
import { emitHoverZonesFor } from './hover-emit'
import { getOrCreateOcrBackend } from './ocr/backend'
import { refineResult } from './ocr/refine'
import { ocrResultToText, type OcrResult } from './ocr/types'
import { sendToOverlay } from './window'

// ===== Test VN capturePage path =====
//
// macOS ScreenCaptureKit (used by Electron 39's getDisplayMedia on macOS
// 14.4+) throttles frame delivery for windows that aren't being directly
// interacted with. Our test fixture is an Electron-owned BrowserWindow that
// goes idle between user clicks — its content updates visibly, but the
// capture stream stays stale until the user does something like dragging
// to highlight text inside the window.
//
// For windows we own, webContents.capturePage() pulls a fresh image from
// Chromium's compositor on demand. We poll it at 5fps, crop to the user's
// region, and feed the result straight through the OCR backend +
// in-process dedupe. This bypasses ScreenCaptureKit entirely for the test
// rig. Real (third-party) VNs render continuously and don't trip the
// throttle, so they keep using the standard getDisplayMedia path.

let testVnWindow: BrowserWindow | null = null
let testVnPoll: NodeJS.Timeout | null = null
let testVnRegion: SharedRegion | null = null
let testVnInFlight = false
let testVnLastEmit = ''
let testVnLastPng: Buffer | null = null

async function pollTestVnFrame(): Promise<void> {
  if (testVnInFlight) return
  if (!testVnWindow || testVnWindow.isDestroyed() || !testVnRegion) return
  testVnInFlight = true
  try {
    const img = await testVnWindow.webContents.capturePage()
    const r = testVnRegion
    if (!r) return
    const cropped = img.crop({ x: r.x, y: r.y, width: r.w, height: r.h })
    if (cropped.isEmpty()) {
      const full = img.getSize()
      console.log(
        `[test-vn poll] cropped is empty: full=${full.width}x${full.height}, region=${r.x},${r.y} ${r.w}x${r.h}`
      )
      return
    }
    const backend = getOrCreateOcrBackend()
    if (!backend) return
    const png = cropped.toPNG()
    // Skip the OCR pipeline on byte-identical frames. The poll runs at 5fps
    // but Test VN content holds between line advances; without this we'd
    // re-OCR (and re-refine) the same line ~5 times a second.
    if (testVnLastPng?.equals(png)) return
    testVnLastPng = png
    const firstPass = await backend.recognize(png)
    const result = await refineResult(png, firstPass, backend)
    const trimmed = ocrResultToText(result).trim()
    if (!trimmed) return
    if (trimmed !== testVnLastEmit) {
      testVnLastEmit = trimmed
      console.log('[test-vn] emit:', trimmed)
      sendToOverlay(Channels.textLine, trimmed)
    }
    await emitTestVnHoverZones(result, r, png)
  } catch (err) {
    console.error('[test-vn poll] failed:', (err as Error).message)
  } finally {
    testVnInFlight = false
  }
}

async function emitTestVnHoverZones(
  result: OcrResult,
  region: SharedRegion,
  png: Buffer
): Promise<void> {
  if (!testVnWindow || testVnWindow.isDestroyed()) return
  const winBounds = testVnWindow.getContentBounds()
  await emitHoverZonesFor('test-vn', result, region, winBounds, png)
}

function startTestVnPoll(region: SharedRegion): void {
  testVnRegion = region
  testVnLastEmit = ''
  testVnLastPng = null
  if (testVnPoll) return
  console.log('[test-vn] capturePage poll starting at 5fps')
  testVnPoll = setInterval(pollTestVnFrame, 200)
}

/** Called when the user confirms a region: if the pending capture source is
 *  our Test VN window, switch from the renderer-side getDisplayMedia path
 *  to the main-side capturePage poll (see the comment block above). */
export function startTestVnPollIfPending(region: SharedRegion): void {
  if (!testVnWindow || testVnWindow.isDestroyed()) return
  if (testVnWindow.getMediaSourceId() !== getPendingSource()) return
  startTestVnPoll(region)
}

export function stopTestVnPoll(): void {
  if (testVnPoll) {
    clearInterval(testVnPoll)
    testVnPoll = null
    console.log('[test-vn] capturePage poll stopped')
  }
  testVnRegion = null
  testVnLastEmit = ''
  testVnLastPng = null
}

/** Dev-only: spawn a regular BrowserWindow showing mock VN dialogue. The
 *  user picks it in the source picker; capture runs through capturePage so
 *  we exercise OCR + reader without depending on ScreenCaptureKit's
 *  throttling-when-idle behavior. */
export function openTestVnWindow(): void {
  if (testVnWindow && !testVnWindow.isDestroyed()) {
    testVnWindow.focus()
    return
  }
  testVnWindow = new BrowserWindow({
    width: 900,
    height: 600,
    title: 'Test VN',
    backgroundColor: '#0d111a',
    webPreferences: {
      preload: __dirname + '/../preload/index.js',
      contextIsolation: true,
      sandbox: false
    }
  })
  testVnWindow.on('closed', () => {
    testVnWindow = null
    stopTestVnPoll()
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    testVnWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?mode=test-vn')
  } else {
    testVnWindow.loadFile(__dirname + '/../renderer/index.html', {
      search: '?mode=test-vn'
    })
  }
}
