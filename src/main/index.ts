import { app, ipcMain, globalShortcut } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createOverlayWindow, overlayWindow, sendToOverlay } from './window'
import { Channels, type SetIgnorePayload } from '@shared/ipc'
import { TextSource } from './sources/types'
import { ManualPasteSource } from './sources/ManualPasteSource'
import { OCRSource } from './sources/OCRSource'
import { getOrCreateOcrBackend } from './ocr/backend'
import { ocrResultToText } from './ocr/types'
import { refineResult } from './ocr/refine'
import { tokenize, preloadTokenizer } from './tokenize/tokenizer'
import { groupTokens } from './tokenize/grouping'
import { lookup as jmdictLookup, close as jmdictClose } from './dict/jmdict'
import { lookupGroup } from './dict/deinflect'
import { persistCache, probeVlmCreds, getVlmStatus, onVlmStatusChange } from './translate/vlm'
import { handleTranslateRegion, handleForceTranslate } from './translate/handlers'
import { handleSubmitToAnki, probeAnkiConnect } from './mining'
import { emitRealWindowHoverZones, resyncHoverZones, clearHoverZones } from './hover-emit'
import { setActiveSourceWindow, getSourceFocused, closeWindowInfo } from './source-window'
import { openTestVnWindow, startTestVnPollIfPending, stopTestVnPoll } from './test-vn'
import { listWindows } from './capture/picker'
import { configureDisplayMediaHandler, setPendingSource, clearPendingSource } from './capture/stream'
import { getRegion, setRegion } from './storage/regions'
import type {
  CaptureFramePayload,
  SharedJmdictEntry,
  SharedJmdictSense,
  SharedLookupResult,
  SharedRegion,
  SharedWindowSource,
  SharedWordGroup,
  SubmitToAnkiRequest,
  TranslateRegionRequest
} from '@shared/ipc'

const sources: TextSource[] = []
let manualSource: ManualPasteSource | null = null
let ocrSource: OCRSource | null = null

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
  // Ships the displayed text to the renderer. Translation runs separately on
  // hover (Ship 2.8): a single emit on a multi-region screen would dump every
  // text block into one VLM call — wasteful and ineffective. The renderer
  // triggers translateRegion per hovered line instead.
  s.on('text', (line) => {
    sendToOverlay(Channels.textLine, line)
  })
  s.on('status', (status) => {
    sendToOverlay(Channels.textStatus, status)
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
    overlayWindow()?.setIgnoreMouseEvents(payload.ignore, { forward: true })
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
    // the live screen position of that window. Every window source gets an
    // id — including the Test VN's own BrowserWindow — so focus tracking
    // runs for all of them; null covers screen sources only.
    const m = sourceId.match(/^window:(\d+):/)
    const windowId = m && m[1] ? Number(m[1]) : null
    console.log(`[capture] active source window id = ${windowId}`)
    // Zones and frames latched for the previous source are dead now —
    // clear atomically so a stale hover can't translate/mine against them.
    clearHoverZones()
    setActiveSourceWindow(windowId)
  })

  ipcMain.on(Channels.captureStop, () => {
    clearPendingSource()
    stopTestVnPoll()
    setActiveSourceWindow(null)
    clearHoverZones()
  })

  ipcMain.on(Channels.hoverResync, () => {
    resyncHoverZones()
  })

  ipcMain.handle(Channels.sourceFocusGet, () => getSourceFocused())

  ipcMain.handle(Channels.vlmStatusGet, () => getVlmStatus())

  // Forward VLM status transitions to the overlay so the status strip
  // updates on creds change, unreachable failure, or recovery.
  onVlmStatusChange((s) => {
    sendToOverlay(Channels.vlmStatus, s)
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
      startTestVnPollIfPending(payload.region)
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
    if (trimmed) sendToOverlay(Channels.textLine, trimmed)
    return trimmed
  })

  ipcMain.on(Channels.devOpenTestVN, () => {
    openTestVnWindow()
  })

  createOverlayWindow()

  // Hover-prototype hotkeys. The overlay window is focusable: false, so
  // renderer-side keydown listeners never fire — register globally and
  // forward via IPC.
  const okMode = globalShortcut.register('CommandOrControl+Shift+H', () => {
    sendToOverlay(Channels.hoverHotkey, 'toggle-mode')
  })
  const okDebug = globalShortcut.register('CommandOrControl+Shift+D', () => {
    sendToOverlay(Channels.hoverHotkey, 'toggle-debug')
  })
  const okForce = globalShortcut.register('CommandOrControl+Shift+T', () => {
    void handleForceTranslate()
  })
  const okMine = globalShortcut.register('CommandOrControl+Shift+M', () => {
    sendToOverlay(Channels.miningHotkey)
  })
  if (!okMode || !okDebug || !okForce || !okMine) {
    console.warn(
      `[hotkeys] register failed: mode=${okMode}, debug=${okDebug}, force=${okForce}, mine=${okMine}`
    )
  }

  // Probe the VLM proxy creds at startup so the status pill in the
  // overlay strip has a meaningful initial value before any hover fires.
  probeVlmCreds()

  void probeAnkiConnect()

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
    if (!overlayWindow()) {
      createOverlayWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', async () => {
  await Promise.all(sources.map((s) => s.stop()))
  await closeWindowInfo()
  persistCache()
  jmdictClose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
