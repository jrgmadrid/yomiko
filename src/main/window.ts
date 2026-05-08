import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { config } from './config'

export function createOverlayWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const { width: dw, height: dh } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  const width = Math.min(config.overlay.width, dw)
  const height = config.overlay.height
  const x = dx + Math.round((dw - width) / 2)
  const y = config.overlay.position === 'bottom' ? dy + dh - height : dy

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')

  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('ready-to-show', () => win.showInactive())

  // Re-issue forwarding after every reload — Electron #15376.
  win.webContents.on('did-finish-load', () => {
    win.setIgnoreMouseEvents(true, { forward: true })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
