import { app, ipcMain, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createOverlayWindow } from './window'
import { Channels, type SetIgnorePayload } from '@shared/ipc'
import { config } from './config'
import { TextSource } from './sources/types'
import { ManualPasteSource } from './sources/ManualPasteSource'
import { TextractorWSSource } from './sources/TextractorWSSource'
import { tokenize, preloadTokenizer } from './tokenize/tokenizer'
import { groupTokens } from './tokenize/grouping'
import { lookup as jmdictLookup, close as jmdictClose } from './dict/jmdict'
import { lookupGroup } from './dict/deinflect'
import type {
  SharedJmdictEntry,
  SharedJmdictSense,
  SharedLookupResult,
  SharedWordGroup
} from '@shared/ipc'

let overlay: BrowserWindow | null = null
const sources: TextSource[] = []
let manualSource: ManualPasteSource | null = null

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

  overlay = createOverlayWindow()

  manualSource = new ManualPasteSource()
  bindSource(manualSource)
  await manualSource.start()
  sources.push(manualSource)

  const wsSource = new TextractorWSSource(config.ws)
  bindSource(wsSource)
  await wsSource.start()
  sources.push(wsSource)

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
