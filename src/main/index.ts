import { app, ipcMain, BrowserWindow, nativeImage, screen, globalShortcut } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createOverlayWindow } from './window'
import { Channels, type SetIgnorePayload } from '@shared/ipc'
import { TextSource } from './sources/types'
import { ManualPasteSource } from './sources/ManualPasteSource'
import { OCRSource } from './sources/OCRSource'
import { AppleVisionBackend } from './ocr/apple-vision'
import { WindowsMediaBackend } from './ocr/windows-media'
import { ocrResultToText, type OcrBackend, type OcrRect, type OcrResult } from './ocr/types'
import { refineResult } from './ocr/refine'
import { buildHoverZones, hoverPayload } from './ocr/hover-zones'
import { MacWindowInfo, type WindowBounds } from './window-info/macos'
import { tokenize, preloadTokenizer } from './tokenize/tokenizer'
import { groupTokens } from './tokenize/grouping'
import type { FrameOcrData } from './sources/types'
import { lookup as jmdictLookup, close as jmdictClose } from './dict/jmdict'
import { lookupGroup } from './dict/deinflect'
import { translateRegionImage, persistCache } from './translate/vlm'
import { listWindows } from './capture/picker'
import {
  ankiVersion,
  storeMediaFile,
  addNote,
  AnkiUnreachableError,
  AnkiDuplicateError
} from './anki/client'
import { composeNote, type MiningInput } from './anki/compose'
import { getAnkiConfig } from './storage/anki-config'
import {
  configureDisplayMediaHandler,
  setPendingSource,
  clearPendingSource,
  getPendingSource as pendingSourceId
} from './capture/stream'
import { getRegion, setRegion } from './storage/regions'
import type {
  CaptureFramePayload,
  MiningResultPayload,
  RegionTranslationPayload,
  SharedJmdictEntry,
  SharedJmdictSense,
  SharedLookupResult,
  SharedRegion,
  SharedWindowSource,
  SharedWordGroup,
  SubmitToAnkiRequest,
  TranslateRegionRequest
} from '@shared/ipc'

let overlay: BrowserWindow | null = null
const sources: TextSource[] = []
let manualSource: ManualPasteSource | null = null
let ocrSource: OCRSource | null = null

// Ships the displayed text to the renderer. Translation runs separately on
// hover (Ship 2.8): a single emit on a multi-region screen would dump every
// text block into one VLM call — wasteful and ineffective. The renderer
// triggers translateRegion per hovered line instead.
function emitTextLine(text: string): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.webContents.send(Channels.textLine, text)
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

// Real-window (non-Test-VN) hover-zone state. activeSourceWindowId is the
// CGWindowID parsed from the desktopCapturer source ID when the user picks
// a window. windowInfoBackend is the persistent Swift sidecar that returns
// bounds for that window each time we map an OCR'd bbox to screen coords.
let activeSourceWindowId: number | null = null
let windowInfoBackend: MacWindowInfo | null = null

// Latest-frame latch shared by both capture paths. Hover-driven VLM
// translation crops from this PNG using the line bbox indexed by the
// renderer's TranslateRegionRequest. Stale `translateRegion` calls (older
// frame than the current latch) are silently dropped — the renderer has
// already moved on by the time the IPC arrives.
interface LatestFrame {
  frameId: number
  png: Buffer
  result: OcrResult
  region: SharedRegion
}
let frameCounter = 0
let latestFrame: LatestFrame | null = null

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
    await emitTestVnHoverZones(result, r, png)
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
//
// Stashes the (frameId, png, result, region) tuple in latestFrame so the
// translateRegion IPC handler can crop the PNG by line bbox without
// re-capturing or re-running OCR.
async function emitHoverZonesFor(
  label: 'test-vn' | 'real-window',
  result: OcrResult,
  region: SharedRegion,
  captureOrigin: { x: number; y: number },
  png: Buffer
): Promise<void> {
  if (!overlay || overlay.isDestroyed()) return
  const frameId = ++frameCounter
  latestFrame = { frameId, png, result, region }
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

async function emitTestVnHoverZones(
  result: OcrResult,
  region: SharedRegion,
  png: Buffer
): Promise<void> {
  if (!testVnWindow || testVnWindow.isDestroyed()) return
  const winBounds = testVnWindow.getContentBounds()
  await emitHoverZonesFor('test-vn', result, region, winBounds, png)
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
  await emitHoverZonesFor('real-window', data.result, data.region, bounds, data.png)
}

// Crop the source PNG around a single OCR'd line, with generous padding
// perpendicular to the writing axis so the VLM sees wrapped continuations.
// Horizontal text wraps to the line below → vertical pad; vertical text
// wraps to the column beside → horizontal pad. The orientation flips which
// axis gets the wrap-pad and which gets the slop-pad.
function cropAroundLine(png: Buffer, rect: OcrRect): Buffer | null {
  const img = nativeImage.createFromBuffer(png)
  const { width: imgW, height: imgH } = img.getSize()
  const isVertical = rect.h > rect.w * 1.5
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

async function handleTranslateRegion(req: TranslateRegionRequest): Promise<void> {
  const frame = latestFrame
  if (!frame || frame.frameId !== req.frameId) {
    console.log(
      `[translate-region] stale frameId ${req.frameId} (current ${frame?.frameId ?? 'none'}); dropping`
    )
    return
  }
  const line = frame.result.lines[req.lineIdx]
  if (!line) {
    console.warn(`[translate-region] no line ${req.lineIdx} in frame ${req.frameId}`)
    return
  }
  const crop = cropAroundLine(frame.png, line.rect)
  if (!crop) {
    console.warn(`[translate-region] crop empty for line ${req.lineIdx}`)
    return
  }
  const cacheKey = line.text.trim()
  console.log(
    `[translate-region] frame=${req.frameId} line=${req.lineIdx} crop=${crop.length}B firstPass="${cacheKey}"`
  )
  const result = await translateRegionImage(crop, cacheKey)
  if (!result) return
  if (!overlay || overlay.isDestroyed()) return
  const payload: RegionTranslationPayload = {
    frameId: req.frameId,
    lineIdx: req.lineIdx,
    text: result.text,
    translation: result.translation
  }
  overlay.webContents.send(Channels.regionTranslation, payload)
}

// Cmd+Shift+T → translate the entire latest frame, bypassing hover zones.
// Exists for the Vision-blind-spot case: stylized fonts, Buddhist mantra
// scenes, calligraphic title cards where Vision returns zero lines and the
// per-hover VLM path stays dormant because there's nothing to hover.
// Toggling: a second press dismisses; a press during an in-flight fetch
// cancels by dropping the eventual result. The flag is main-side because
// the hotkey arrives main-side and the cancel decision has to be too —
// the renderer can't drop a result main is about to dispatch.
let forceTranslateActive = false

async function handleForceTranslate(): Promise<void> {
  if (forceTranslateActive) {
    forceTranslateActive = false
    overlay?.webContents.send(Channels.forceTranslation, { kind: 'dismiss' })
    return
  }
  const frame = latestFrame
  if (!frame) {
    console.warn('[force-translate] no frame in latch yet')
    return
  }
  forceTranslateActive = true
  overlay?.webContents.send(Channels.forceTranslation, { kind: 'start' })
  const visionText = ocrResultToText(frame.result).trim()
  // When Vision found something, key by that for cross-frame dedupe.
  // When Vision found nothing (the named failure case this hotkey exists
  // for), fall back to frameId — intra-frame dedupe only, which still
  // covers "user pressed the hotkey twice in a row by accident."
  const cacheKey = `force:${visionText || `frame:${frame.frameId}`}`
  const result = await translateRegionImage(frame.png, cacheKey)
  if (!forceTranslateActive) return // user dismissed mid-fetch
  if (!result) {
    forceTranslateActive = false
    overlay?.webContents.send(Channels.forceTranslation, { kind: 'dismiss' })
    return
  }
  overlay?.webContents.send(Channels.forceTranslation, {
    kind: 'result',
    text: result.text,
    translation: result.translation
  })
}

// Cmd+Shift+M → mine the currently hovered token (or focused line) to
// Anki. The renderer holds the live hover state, so the hotkey only triggers
// over IPC; the renderer responds with a SubmitToAnkiRequest, and main
// composes the card from the latestFrame latch + dict lookup + AnkiConnect.
function sendMiningResult(payload: MiningResultPayload): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.webContents.send(Channels.miningResult, payload)
}

function extractGlosses(group: SharedWordGroup): string[] | null {
  const result = lookupGroup(group)
  const entry = result.entries[0]
  if (!entry) return null
  // Numbered glosses, one sense per line. Matches the readable format of
  // jp-mining-note's WordMeaning field without HTML; users with HTML-rich
  // templates can post-process.
  return entry.senses.map((sense, i) => {
    const text = sense.gloss.map((g) => g.text).join('; ')
    return `${i + 1}. ${text}`
  })
}

async function handleSubmitToAnki(req: SubmitToAnkiRequest): Promise<void> {
  const frame = latestFrame
  if (!frame || frame.frameId !== req.frameId) {
    console.log(
      `[mining] stale frameId ${req.frameId} (current ${frame?.frameId ?? 'none'}); dropping`
    )
    sendMiningResult({ ok: false, error: 'STALE_FRAME', message: 'frame advanced before mine' })
    return
  }
  const line = frame.result.lines[req.lineIdx]
  if (!line) {
    sendMiningResult({ ok: false, error: 'NO_TARGET', message: `no line ${req.lineIdx} in frame` })
    return
  }
  const crop = cropAroundLine(frame.png, line.rect)
  if (!crop) {
    sendMiningResult({ ok: false, error: 'NO_TARGET', message: 'crop empty' })
    return
  }

  const config = await getAnkiConfig()
  const filename = `yomiko-${Date.now()}.png`
  const sentence = req.vlmText ?? line.text

  let reading: string | null = null
  let glosses: string[] | null = null
  if (req.hoveredGroup) {
    reading = req.hoveredGroup.reading || null
    glosses = extractGlosses(req.hoveredGroup)
  }

  const input: MiningInput = {
    surface: req.hoveredSurface,
    reading,
    glosses,
    sentence,
    sentenceTranslation: req.vlmTranslation,
    pictureFilename: filename
  }

  console.log(
    `[mining] frame=${req.frameId} line=${req.lineIdx} surface="${req.hoveredSurface ?? '(none)'}" → ${config.deckName}/${config.modelName}`
  )

  try {
    await storeMediaFile(
      { filename, data: crop.toString('base64') },
      config.ankiConnectUrl
    )
    const payload = composeNote(input, config)
    const noteId = await addNote(payload, config.ankiConnectUrl)
    console.log(`[mining] addNote ok, noteId=${noteId}`)
    sendMiningResult({ ok: true, noteId })
  } catch (err) {
    if (err instanceof AnkiUnreachableError) {
      console.warn(`[mining] AnkiConnect unreachable: ${err.message}`)
      sendMiningResult({ ok: false, error: 'ANKI_UNREACHABLE', message: err.message })
    } else if (err instanceof AnkiDuplicateError) {
      console.log(`[mining] duplicate rejected: ${err.message}`)
      sendMiningResult({ ok: false, error: 'DUPLICATE', message: err.message })
    } else {
      const msg = (err as Error).message
      console.warn(`[mining] addNote failed: ${msg}`)
      sendMiningResult({ ok: false, error: 'ANKI_ERROR', message: msg })
    }
  }
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

  ipcMain.on(Channels.translateRegion, (_event, req: TranslateRegionRequest) => {
    void handleTranslateRegion(req)
  })

  ipcMain.on(Channels.submitToAnki, (_event, req: SubmitToAnkiRequest) => {
    void handleSubmitToAnki(req)
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
  const okForce = globalShortcut.register('CommandOrControl+Shift+T', () => {
    void handleForceTranslate()
  })
  const okMine = globalShortcut.register('CommandOrControl+Shift+M', () => {
    overlay?.webContents.send(Channels.miningHotkey)
  })
  if (!okMode || !okDebug || !okForce || !okMine) {
    console.warn(
      `[hotkeys] register failed: mode=${okMode}, debug=${okDebug}, force=${okForce}, mine=${okMine}`
    )
  }

  // Best-effort connectivity probe so the user knows up-front whether Anki
  // is reachable. Fire-and-forget; the mining hotkey re-checks per-call.
  void (async () => {
    try {
      const config = await getAnkiConfig()
      const v = await ankiVersion(config.ankiConnectUrl)
      console.log(`[anki] AnkiConnect detected (v${v}) at ${config.ankiConnectUrl}`)
    } catch (err) {
      console.log(
        `[anki] not reachable on startup: ${(err as Error).message} — mining will surface errors when used`
      )
    }
  })()

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
  persistCache()
  jmdictClose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
