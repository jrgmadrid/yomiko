import { app, ipcMain, BrowserWindow, screen, globalShortcut } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createOverlayWindow } from './window'
import { Channels, type SetIgnorePayload } from '@shared/ipc'
import { TextSource } from './sources/types'
import { ManualPasteSource } from './sources/ManualPasteSource'
import { OCRSource } from './sources/OCRSource'
import { AppleVisionBackend } from './ocr/apple-vision'
import { WindowsMediaBackend } from './ocr/windows-media'
import { ocrResultToText, type OcrBackend, type OcrResult } from './ocr/types'
import { refineResult } from './ocr/refine'
import { buildHoverZones, hoverPayload } from './ocr/hover-zones'
import { MacWindowInfo, type WindowBounds } from './window-info/macos'
import { tokenize, preloadTokenizer } from './tokenize/tokenizer'
import { groupTokens } from './tokenize/grouping'
import type { FrameOcrData } from './sources/types'
import { lookup as jmdictLookup, close as jmdictClose } from './dict/jmdict'
import { lookupGroup } from './dict/deinflect'
import { translateLine, closeTranslator } from './translate'
import { listWindows } from './capture/picker'
import {
  configureDisplayMediaHandler,
  setPendingSource,
  clearPendingSource,
  getPendingSource as pendingSourceId
} from './capture/stream'
import { getRegion, setRegion } from './storage/regions'
import type {
  CaptureFramePayload,
  SharedJmdictEntry,
  SharedJmdictSense,
  SharedLookupResult,
  SharedRegion,
  SharedWindowSource,
  SharedWordGroup,
  TranslationPayload
} from '@shared/ipc'

let overlay: BrowserWindow | null = null
const sources: TextSource[] = []
let manualSource: ManualPasteSource | null = null
let ocrSource: OCRSource | null = null

// Single seam for line-emit so translation hooks at one point. All call sites
// (Textractor/manual-paste via bindSource, Test VN poll, devOcrTest) go
// through here. Translation is fire-and-forget; failure or no-key disables
// it silently and the source line still ships immediately.
//
// `text` is what the renderer displays (full OCR result). The translation
// candidate is text with non-JP lines stripped, so when OCR pulls in chrome
// like "[game scene]" alongside the actual VN line, we don't pay DeepSeek
// to translate the chrome (and the user doesn't see a translation that
// mostly repeats English they can already read).
//
// Hiragana, katakana, CJK ideographs (incl. extension A and compat) — same
// predicate as ocr/hover-zones.ts hasJapanese, kept inline so the import
// graph stays clean.
const JAPANESE_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/

function emitTextLine(text: string): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.webContents.send(Channels.textLine, text)

  const translatable = text
    .split('\n')
    .filter((line) => JAPANESE_REGEX.test(line))
    .join('\n')
    .trim()
  if (!translatable) return

  void translateLine(translatable).then((result) => {
    if (!result || !overlay || overlay.isDestroyed()) return
    // `source` echoes the displayed text so the renderer can match the
    // translation to the displayed line; the translatable subset is an
    // implementation detail of what we sent upstream.
    const payload: TranslationPayload = {
      source: text,
      text: result.text,
      from: result.from,
      to: result.to
    }
    overlay.webContents.send(Channels.translateLine, payload)
  })
}

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
let testVnFrameId = 0

// Real-window (non-Test-VN) hover-zone state. activeSourceWindowId is the
// CGWindowID parsed from the desktopCapturer source ID when the user picks
// a window. windowInfoBackend is the persistent Swift sidecar that returns
// bounds for that window each time we map an OCR'd bbox to screen coords.
let activeSourceWindowId: number | null = null
let realFrameId = 0
let windowInfoBackend: MacWindowInfo | null = null

function getWindowInfo(): MacWindowInfo | null {
  if (process.platform !== 'darwin') return null
  if (!windowInfoBackend) windowInfoBackend = new MacWindowInfo()
  return windowInfoBackend
}

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
      emitTextLine(trimmed)
    }
    await emitTestVnHoverZones(result, r)
  } catch (err) {
    console.error('[test-vn poll] failed:', (err as Error).message)
  } finally {
    testVnInFlight = false
  }
}

// Hover-zone emit. The two callers differ only in how they discover the
// capture origin (where the captured image lives in screen DIPs):
//   - Test VN: BrowserWindow.getContentBounds() — capturePage returns the
//     content area, not the framed window, so this matches.
//   - Real third-party windows: macos-window-info sidecar (kCGWindowBounds).
//     SCK captures the full framed window and CG bounds match it.
// Win parity will add a third branch (windows-window-info via DwmGetWindowAttribute).
async function emitHoverZonesFor(
  label: 'test-vn' | 'real-window',
  result: OcrResult,
  region: SharedRegion,
  captureOrigin: { x: number; y: number },
  frameId: number
): Promise<void> {
  if (!overlay || overlay.isDestroyed()) return
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
  overlay.webContents.send(Channels.hoverZones, payload)
}

async function emitTestVnHoverZones(result: OcrResult, region: SharedRegion): Promise<void> {
  if (!testVnWindow || testVnWindow.isDestroyed()) return
  const winBounds = testVnWindow.getContentBounds()
  await emitHoverZonesFor('test-vn', result, region, winBounds, ++testVnFrameId)
}

async function emitRealWindowHoverZones(data: FrameOcrData): Promise<void> {
  if (activeSourceWindowId === null) return
  const wi = getWindowInfo()
  if (!wi) return
  let bounds: WindowBounds | null
  try {
    bounds = await wi.lookup(activeSourceWindowId)
  } catch (err) {
    console.error('[real-window] window-info lookup failed:', (err as Error).message)
    return
  }
  if (!bounds) {
    console.log(`[real-window] window ${activeSourceWindowId} not on-screen`)
    return
  }
  await emitHoverZonesFor('real-window', data.result, data.region, bounds, ++realFrameId)
}

function startTestVnPoll(region: SharedRegion): void {
  testVnRegion = region
  testVnLastEmit = ''
  testVnLastPng = null
  if (testVnPoll) return
  console.log('[test-vn] capturePage poll starting at 5fps')
  testVnPoll = setInterval(pollTestVnFrame, 200)
}

function stopTestVnPoll(): void {
  if (testVnPoll) {
    clearInterval(testVnPoll)
    testVnPoll = null
    console.log('[test-vn] capturePage poll stopped')
  }
  testVnRegion = null
  testVnLastEmit = ''
  testVnLastPng = null
}

let ocrBackend: OcrBackend | null = null
function getOrCreateOcrBackend(): OcrBackend | null {
  if (ocrBackend) return ocrBackend
  if (process.platform === 'darwin') ocrBackend = new AppleVisionBackend()
  else if (process.platform === 'win32') ocrBackend = new WindowsMediaBackend()
  return ocrBackend
}

function getOrCreateOcrSource(): OCRSource | null {
  if (ocrSource) return ocrSource
  const backend = getOrCreateOcrBackend()
  if (!backend) {
    console.warn(`[ocr-source] no backend for platform ${process.platform}`)
    return null
  }
  ocrSource = new OCRSource(backend)
  bindSource(ocrSource)
  void ocrSource.start()
  sources.push(ocrSource)
  return ocrSource
}

function bindSource(s: TextSource): void {
  s.on('text', (line) => {
    emitTextLine(line)
  })
  s.on('status', (status) => {
    overlay?.webContents.send(Channels.textStatus, status)
  })
  s.on('frame-ocr', (data) => {
    void emitRealWindowHoverZones(data)
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('dev.yomiko.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on(Channels.overlaySetIgnore, (_event, payload: SetIgnorePayload) => {
    if (!overlay || overlay.isDestroyed()) return
    overlay.setIgnoreMouseEvents(payload.ignore, { forward: true })
  })

  ipcMain.on(Channels.devPaste, (_event, line: string) => {
    manualSource?.feed(line)
  })

  ipcMain.handle(Channels.tokenizeLine, async (_event, line: string): Promise<SharedWordGroup[]> => {
    const tokens = await tokenize(line)
    return groupTokens(tokens)
  })

  function toSharedEntry(e: ReturnType<typeof jmdictLookup>[number]): SharedJmdictEntry {
    return {
      id: e.id,
      kanji: e.kanji.map((k) => ({ common: k.common, text: k.text })),
      kana: e.kana.map((k) => ({ common: k.common, text: k.text })),
      senses: e.senses.map(
        (s): SharedJmdictSense => ({
          partOfSpeech: s.partOfSpeech,
          field: s.field,
          misc: s.misc,
          info: s.info,
          gloss: s.gloss
        })
      ),
      matchedForm: e.matchedForm,
      matchedIsKanji: e.matchedIsKanji
    }
  }

  ipcMain.handle(Channels.dictLookup, (_event, form: string): SharedJmdictEntry[] => {
    return jmdictLookup(form).map(toSharedEntry)
  })

  ipcMain.handle(
    Channels.dictLookupWithDeinflect,
    (_event, group: SharedWordGroup): SharedLookupResult => {
      const result = lookupGroup(group)
      return {
        matched: result.matched,
        chain: result.chain.map((s) => ({ description: s.description })),
        entries: result.entries.map(toSharedEntry)
      }
    }
  )

  configureDisplayMediaHandler()

  ipcMain.handle(Channels.captureListWindows, async (): Promise<SharedWindowSource[]> => {
    return listWindows()
  })

  ipcMain.on(Channels.captureSetSource, (_event, sourceId: string) => {
    setPendingSource(sourceId)
    // macOS desktopCapturer source IDs encode the CGWindowID as the second
    // segment: "window:WINDOW_NUMBER:0". Parse it so we can later look up
    // the live screen position of that window.
    const m = sourceId.match(/^window:(\d+):/)
    activeSourceWindowId = m && m[1] ? Number(m[1]) : null
    console.log(`[capture] active source window id = ${activeSourceWindowId}`)
  })

  ipcMain.on(Channels.captureStop, () => {
    clearPendingSource()
    stopTestVnPoll()
  })

  ipcMain.on(Channels.captureFrame, (_event, payload: CaptureFramePayload) => {
    const src = getOrCreateOcrSource()
    if (!src) return
    void src.ingestFrame(payload)
  })

  ipcMain.handle(
    Channels.regionsGet,
    async (_event, windowName: string): Promise<SharedRegion | null> => getRegion(windowName)
  )

  ipcMain.handle(
    Channels.regionsSet,
    async (_event, payload: { windowName: string; region: SharedRegion }): Promise<void> => {
      await setRegion(payload.windowName, payload.region)
      // If the user just confirmed a region for our Test VN window, switch
      // capture from the renderer-side getDisplayMedia path to a main-side
      // webContents.capturePage poll (see the Test VN comment block above).
      if (testVnWindow && !testVnWindow.isDestroyed()) {
        const id = testVnWindow.getMediaSourceId()
        if (id === pendingSourceId()) {
          startTestVnPoll(payload.region)
        }
      }
    }
  )

  // Dev-only: bypass capture + stabilizer + dedupe. Take a PNG of a synthetic
  // VN line, run it straight through the OCR backend, emit the result as a
  // text:line so it flows through tokenize + JMdict + popup UI.
  ipcMain.handle(Channels.devOcrTest, async (_event, png: ArrayBuffer): Promise<string> => {
    const backend = getOrCreateOcrBackend()
    if (!backend) throw new Error(`no OCR backend for platform ${process.platform}`)
    const buf = Buffer.from(png)
    const firstPass = await backend.recognize(buf)
    const result = await refineResult(buf, firstPass, backend)
    const trimmed = ocrResultToText(result).trim()
    if (trimmed) emitTextLine(trimmed)
    return trimmed
  })

  // Dev-only: spawn a regular BrowserWindow showing mock VN dialogue. The
  // user picks it in the source picker; capture runs through capturePage
  // (see startTestVnPoll comment) so we exercise OCR + reader without
  // depending on ScreenCaptureKit's throttling-when-idle behavior.
  ipcMain.on(Channels.devOpenTestVN, () => {
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
  })

  overlay = createOverlayWindow()

  // Hover-prototype hotkeys. The overlay window is focusable: false, so
  // renderer-side keydown listeners never fire — register globally and
  // forward via IPC.
  const okMode = globalShortcut.register('CommandOrControl+Shift+H', () => {
    overlay?.webContents.send(Channels.hoverHotkey, 'toggle-mode')
  })
  const okDebug = globalShortcut.register('CommandOrControl+Shift+D', () => {
    overlay?.webContents.send(Channels.hoverHotkey, 'toggle-debug')
  })
  if (!okMode || !okDebug) {
    console.warn(`[hotkeys] register failed: mode=${okMode}, debug=${okDebug}`)
  }

  manualSource = new ManualPasteSource()
  bindSource(manualSource)
  await manualSource.start()
  sources.push(manualSource)

  // TextractorWSSource is opt-in in Ship 4 (settings toggle for ornamented
  // titles where OCR fails). Ship 2's default flow is OCR-on-window-capture.

  // Warm the kuromoji dict in the background — first line shouldn't pay the
  // ~150ms init cost.
  preloadTokenizer().catch((err) => {
    console.error('tokenizer preload failed:', err)
  })

  app.on('activate', () => {
    if (!overlay || overlay.isDestroyed()) {
      overlay = createOverlayWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', async () => {
  await Promise.all(sources.map((s) => s.stop()))
  await windowInfoBackend?.close()
  await closeTranslator()
  jmdictClose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
