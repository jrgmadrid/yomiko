import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

const OVERLAY_HEIGHT = 140
const PICKER_WIDTH = 880
const PICKER_HEIGHT = 640
const PICKER_INSET = 32

export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

export function getOverlayBarBounds(): OverlayBounds {
  const display = screen.getPrimaryDisplay()
  const { width: dw, height: dh } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea
  return {
    x: dx,
    y: dy + dh - OVERLAY_HEIGHT,
    width: dw,
    height: OVERLAY_HEIGHT
  }
}

// Picker mode resizes the overlay into a top-left modal-shaped window large
// enough to host the source picker UI without cramping the drag-rectangle
// region selector. Top-left positioning leaves the captured target window
// (typically larger and roughly centered) at least partially visible — so
// Chromium's occlusion tracker doesn't pause its compositor and the live
// preview stays fresh.
export function getOverlayPickerBounds(): OverlayBounds {
  const display = screen.getPrimaryDisplay()
  const { x: dx, y: dy } = display.workArea
  return {
    x: dx + PICKER_INSET,
    y: dy + PICKER_INSET,
    width: PICKER_WIDTH,
    height: PICKER_HEIGHT
  }
}

// The overlay is a thin strip at the bottom of the screen — NOT a full-screen
// transparent window. The full-screen variant from Ship 1 caused Chromium's
// NativeWindowOcclusionTracker to mark the captured target window as
// occluded, pausing its compositor and freezing capture (see commit log for
// the dogfood autopsy). Hover popups now live in their own BrowserWindow
// (createPopupWindow) which is shown on demand.
export function createOverlayWindow(): BrowserWindow {
  const bounds = getOverlayBarBounds()

  const win = new BrowserWindow({
    ...bounds,
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
  win.setContentProtection(true)

  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('ready-to-show', () => win.showInactive())

  win.webContents.on('did-finish-load', () => {
    win.setIgnoreMouseEvents(true, { forward: true })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Popup window for Yomitan-style hover dictionary popups. Hidden until the
// renderer asks to show it at a specific cursor position. Lives outside the
// captured target's bounds in normal use, so it never triggers the
// occlusion-pause issue the overlay-bar split was meant to fix.
export function createPopupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 240,
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
  win.setContentProtection(true)
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?mode=popup')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      search: '?mode=popup'
    })
  }

  return win
}
