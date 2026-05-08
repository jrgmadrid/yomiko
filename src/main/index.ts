import { app, ipcMain, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createOverlayWindow } from './window'
import { Channels, type SetIgnorePayload } from './ipc/channels'

let overlay: BrowserWindow | null = null

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.yomiko.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on(Channels.overlaySetIgnore, (_event, payload: SetIgnorePayload) => {
    if (!overlay || overlay.isDestroyed()) return
    overlay.setIgnoreMouseEvents(payload.ignore, { forward: true })
  })

  overlay = createOverlayWindow()

  app.on('activate', () => {
    if (!overlay || overlay.isDestroyed()) {
      overlay = createOverlayWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
