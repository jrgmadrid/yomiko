import { resolve } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { JsonLineSidecar } from '../ocr/sidecar'

// Bounds in macOS screen DIPs (top-left origin) — matches BrowserWindow.getBounds().
export interface WindowBounds {
  x: number
  y: number
  w: number
  h: number
}

interface SidecarOutput {
  bounds?: [number, number, number, number]
  error?: string
}

function binPath(): string {
  const root = is.dev ? app.getAppPath() : process.resourcesPath
  return resolve(root, is.dev ? 'resources/bin/macos-window-info' : 'bin/macos-window-info')
}

export class MacWindowInfo extends JsonLineSidecar<SidecarOutput> {
  constructor() {
    super({ label: 'window-info', binPath })
  }

  protected parseResponse(json: unknown): SidecarOutput {
    return json as SidecarOutput
  }

  /** Returns null if the window is no longer on-screen (e.g. minimized). */
  async lookup(windowId: number): Promise<WindowBounds | null> {
    const out = await this.send(`${windowId}\n`)
    if (out.error || !out.bounds) return null
    const [x, y, w, h] = out.bounds
    return { x, y, w, h }
  }
}
