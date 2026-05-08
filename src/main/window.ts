import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export function createOverlayWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const { width: dw, height: dh } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  // The window covers the full work area. The renderer keeps actual content
  // (text bar, popups) inside this canvas — the BrowserWindow is large so
  // popups can render *above* the bar without being clipped at the window
  // boundary. Everything else is transparent and click-through.
  const win = new BrowserWindow({
    x: dx,
    y: dy,
    width: dw,
    height: dh,
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
    // Detached DevTools — focusable: false panels swallow F12, and DevTools
    // attached inside the overlay would fight click-through.
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
