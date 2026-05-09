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
import { tokenize, preloadTokenizer } from './tokenize/tokenizer'
import { groupTokens } from './tokenize/grouping'
import { lookup as jmdictLookup, close as jmdictClose } from './dict/jmdict'
import { lookupGroup } from './dict/deinflect'
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
  HoverDebugChar,
  HoverZone,
  HoverZonePayload,
  SharedJmdictEntry,
  SharedJmdictSense,
  SharedLookupResult,
  SharedRegion,
  SharedScreenRect,
  SharedWindowSource,
  SharedWordGroup
} from '@shared/ipc'

let overlay: BrowserWindow | null = null
const sources: TextSource[] = []
let manualSource: ManualPasteSource | null = null
let ocrSource: OCRSource | null = null

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
let testVnFrameId = 0

async function pollTestVnFrame(): Promise<void> {
  if (testVnInFlight) return
  if (!testVnWindow || testVnWindow.isDestroyed() || !testVnRegion) return
  testVnInFlight = true
  try {
    const img = await testVnWindow.webContents.capturePage()
    const r = testVnRegion
    if (!r) return
    const fullSize = img.getSize()
    const cropped = img.crop({ x: r.x, y: r.y, width: r.w, height: r.h })
    if (cropped.isEmpty()) {
      console.log(
        `[test-vn poll] cropped is empty: full=${fullSize.width}x${fullSize.height}, region=${r.x},${r.y} ${r.w}x${r.h}`
      )
      return
    }
    const png = cropped.toPNG()
    const backend = getOrCreateOcrBackend()
    if (!backend) return
    const result = await backend.recognize(png)
    const trimmed = ocrResultToText(result).trim()
    if (!trimmed) return
    if (trimmed !== testVnLastEmit) {
      testVnLastEmit = trimmed
      console.log('[test-vn] emit:', trimmed)
      overlay?.webContents.send(Channels.textLine, trimmed)
    }
    // Always emit hover zones on a successful OCR — the renderer might have
    // toggled into hover mode after the last text change, in which case it
    // missed the prior emit. 5fps is fine for a prototype.
    await emitTestVnHoverZones(result, r)
  } catch (err) {
    console.error('[test-vn poll] failed:', (err as Error).message)
  } finally {
    testVnInFlight = false
  }
}

// Build hover zones for the test VN's owned BrowserWindow path. Coordinate
// transform: cropped-image px → full-capturePage px (+region offset) →
// window DIPs (÷scaleFactor) → screen DIPs (+window bounds) → overlay-window
// CSS px (−overlay bounds). Real (third-party) windows will need a separate
// path that polls window bounds via CGWindowListCopyWindowInfo / GetWindowRect.
// Hiragana, katakana, CJK ideographs (incl. extension A and compat).
// JMdict has no English/Latin/digit entries, so emitting zones for those
// produces empty popups — skip anything without at least one CJK glyph.
const CJK_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/
function hasJapanese(s: string): boolean {
  return CJK_REGEX.test(s)
}

async function emitTestVnHoverZones(result: OcrResult, region: SharedRegion): Promise<void> {
  if (!overlay || overlay.isDestroyed()) return
  if (!testVnWindow || testVnWindow.isDestroyed()) return

  const overlayBounds = overlay.getContentBounds()
  // getContentBounds excludes title-bar / chrome — capturePage returns the
  // content area, not the framed window, so this matches.
  const winBounds = testVnWindow.getContentBounds()
  const display = screen.getDisplayMatching(winBounds)
  const sf = display.scaleFactor

  function toCss(rect: { x: number; y: number; w: number; h: number }): SharedScreenRect {
    return {
      x: (rect.x + region.x) / sf + winBounds.x - overlayBounds.x,
      y: (rect.y + region.y) / sf + winBounds.y - overlayBounds.y,
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
    const cssRects: SharedScreenRect[] = line.chars.map((c) => toCss(c.rect))
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
      console.error('[test-vn] tokenize failed:', (err as Error).message)
      continue
    }

    for (const g of groups) {
      if (g.headPos === '記号' || g.headPos === 'BOS/EOS') continue
      if (!hasJapanese(g.surface)) continue
      const start = Math.max(0, g.start)
      const end = Math.min(line.chars.length, g.end)
      if (end <= start) continue

      let union: SharedScreenRect | null = null
      for (let i = start; i < end; i++) {
        const r2 = cssRects[i]
        if (!r2 || r2.w <= 0 || r2.h <= 0) continue
        if (!union) {
          union = { x: r2.x, y: r2.y, w: r2.w, h: r2.h }
        } else {
          const minX = Math.min(union.x, r2.x)
          const minY = Math.min(union.y, r2.y)
          const maxX = Math.max(union.x + union.w, r2.x + r2.w)
          const maxY = Math.max(union.y + union.h, r2.y + r2.h)
          union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
        }
      }
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

  const payload: HoverZonePayload = {
    frameId: ++testVnFrameId,
    lineText: result.lines.map((l) => l.text).join('\n'),
    zones,
    debugChars
  }
  console.log(
    `[test-vn] hover zones: ${zones.length} tokens, ${debugChars.length} chars (frame ${payload.frameId})`
  )
  overlay.webContents.send(Channels.hoverZones, payload)
}

function startTestVnPoll(region: SharedRegion): void {
  testVnRegion = region
  testVnLastEmit = ''
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
}

let _ocrBackendCache: OcrBackend | null = null
function getOrCreateOcrBackend(): OcrBackend | null {
  if (_ocrBackendCache) return _ocrBackendCache
  _ocrBackendCache = pickOcrBackend()
  return _ocrBackendCache
}

function pickOcrBackend(): OcrBackend | null {
  if (process.platform === 'darwin') return new AppleVisionBackend()
  if (process.platform === 'win32') return new WindowsMediaBackend()
  return null
}

function getOrCreateOcrSource(): OCRSource | null {
  if (ocrSource) return ocrSource
  const backend = pickOcrBackend()
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
    overlay?.webContents.send(Channels.textLine, line)
  })
  s.on('status', (status) => {
    overlay?.webContents.send(Channels.textStatus, status)
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
      // webContents.capturePage poll. ScreenCaptureKit on macOS Tahoe stops
      // delivering fresh frames for windows that aren't being directly
      // interacted with — even when their content is visibly updating.
      // capturePage pulls straight from Chromium's compositor for windows we
      // own. Real (third-party) VNs render continuously via animations and
      // don't trip the SCK throttling.
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
    const result = await backend.recognize(Buffer.from(png))
    const trimmed = ocrResultToText(result).trim()
    if (trimmed && overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(Channels.textLine, trimmed)
    }
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
  jmdictClose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
