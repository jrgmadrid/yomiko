import { app, ipcMain, BrowserWindow, screen } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import {
  createOverlayWindow,
  createPopupWindow,
  getOverlayBarBounds,
  getOverlayPickerBounds
} from './window'
import {
  Channels,
  type OverlayMode,
  type PopupShowPayload,
  type SetIgnorePayload
} from '@shared/ipc'

// Defense in depth against Chromium's NativeWindowOcclusionTracker pausing
// the captured target's compositor. The architectural fix (overlay shrunk
// to a bottom strip) already structurally avoids the problem, but future
// Chromium heuristics could regress; this flag is a one-line guarantee.
// Must run before app.whenReady().
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
import { TextSource } from './sources/types'
import { ManualPasteSource } from './sources/ManualPasteSource'
import { OCRSource } from './sources/OCRSource'
import { AppleVisionBackend } from './ocr/apple-vision'
import { WindowsMediaBackend } from './ocr/windows-media'
import type { OcrBackend } from './ocr/types'
import { tokenize, preloadTokenizer } from './tokenize/tokenizer'
import { groupTokens } from './tokenize/grouping'
import { lookup as jmdictLookup, close as jmdictClose } from './dict/jmdict'
import { lookupGroup } from './dict/deinflect'
import { listWindows } from './capture/picker'
import {
  configureDisplayMediaHandler,
  setPendingSource,
  clearPendingSource
} from './capture/stream'
import { getRegion, setRegion } from './storage/regions'
import type {
  CaptureFramePayload,
  SharedJmdictEntry,
  SharedJmdictSense,
  SharedLookupResult,
  SharedRegion,
  SharedWindowSource,
  SharedWordGroup
} from '@shared/ipc'

let overlay: BrowserWindow | null = null
let popup: BrowserWindow | null = null
const sources: TextSource[] = []
let manualSource: ManualPasteSource | null = null
let ocrSource: OCRSource | null = null

const POPUP_WIDTH = 380
const POPUP_HEIGHT = 240
const POPUP_MARGIN = 10

function getOrCreatePopup(): BrowserWindow {
  if (popup && !popup.isDestroyed()) return popup
  popup = createPopupWindow()
  return popup
}

function placeAndShowPopup(payload: PopupShowPayload): void {
  const win = getOrCreatePopup()
  const display = screen.getDisplayMatching({
    x: Math.round(payload.screenX),
    y: Math.round(payload.screenY),
    width: 1,
    height: 1
  })
  const work = display.workArea

  let x = Math.round(payload.screenX)
  let y = Math.round(payload.anchorTop) - POPUP_HEIGHT - POPUP_MARGIN

  // Flip below the anchor if there's no room above.
  if (y < work.y + POPUP_MARGIN) {
    y = Math.round(payload.anchorBottom) + POPUP_MARGIN
  }
  // Clamp horizontally to the active display.
  if (x + POPUP_WIDTH > work.x + work.width - POPUP_MARGIN) {
    x = work.x + work.width - POPUP_WIDTH - POPUP_MARGIN
  }
  if (x < work.x + POPUP_MARGIN) x = work.x + POPUP_MARGIN

  win.setBounds({ x, y, width: POPUP_WIDTH, height: POPUP_HEIGHT })
  win.webContents.send(Channels.popupData, payload.data)
  if (!win.isVisible()) win.showInactive()
}

function hidePopup(): void {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    popup.hide()
  }
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
    }
  )

  ipcMain.on(Channels.popupShow, (_event, payload: PopupShowPayload) => {
    placeAndShowPopup(payload)
  })

  ipcMain.on(Channels.popupHide, () => {
    hidePopup()
  })

  ipcMain.on(Channels.overlaySetMode, (_event, mode: OverlayMode) => {
    if (!overlay || overlay.isDestroyed()) return
    const next = mode === 'picker' ? getOverlayPickerBounds() : getOverlayBarBounds()
    overlay.setBounds(next)
  })

  // Dev-only: bypass capture + stabilizer + dedupe. Take a PNG of a synthetic
  // VN line, run it straight through the OCR backend, emit the result as a
  // text:line so it flows through tokenize + JMdict + popup UI.
  ipcMain.handle(Channels.devOcrTest, async (_event, png: ArrayBuffer): Promise<string> => {
    const backend = pickOcrBackend()
    if (!backend) throw new Error(`no OCR backend for platform ${process.platform}`)
    const text = await backend.recognize(Buffer.from(png))
    const trimmed = text.trim()
    if (trimmed && overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(Channels.textLine, trimmed)
    }
    return trimmed
  })

  // Dev-only: spawn a regular BrowserWindow showing mock VN dialogue. The
  // user picks it in the source picker and exercises the real capture →
  // diff → OCR → emit pipeline without needing a real game. Window title is
  // "Test VN" so it shows up in the picker (the overlay is excluded via
  // setContentProtection).
  let testVnWindow: BrowserWindow | null = null
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
  // Pre-create the popup window so first hover doesn't pay the load cost.
  getOrCreatePopup()

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

app.on('before-quit', async () => {
  await Promise.all(sources.map((s) => s.stop()))
  jmdictClose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
