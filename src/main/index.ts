import { app, ipcMain, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createOverlayWindow } from './window'
import { Channels, type SetIgnorePayload } from '@shared/ipc'
import { config } from './config'
import { TextSource } from './sources/types'
import { ManualPasteSource } from './sources/ManualPasteSource'
import { TextractorWSSource } from './sources/TextractorWSSource'

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

  overlay = createOverlayWindow()

  manualSource = new ManualPasteSource()
  bindSource(manualSource)
  await manualSource.start()
  sources.push(manualSource)

  const wsSource = new TextractorWSSource(config.ws)
  bindSource(wsSource)
  await wsSource.start()
  sources.push(wsSource)

  app.on('activate', () => {
    if (!overlay || overlay.isDestroyed()) {
      overlay = createOverlayWindow()
    }
  })
})

app.on('before-quit', async () => {
  await Promise.all(sources.map((s) => s.stop()))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
