import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

interface DevRenderOptions {
  fontSize?: number
  width?: number
  background?: string
  color?: string
}

// Renders Japanese text to a PNG via an offscreen canvas — used by
// devRenderAndOcr to feed a synthetic VN line through the real OCR
// pipeline without needing screen capture.
async function renderTextToPng(text: string, opts: DevRenderOptions = {}): Promise<ArrayBuffer> {
  const fontSize = opts.fontSize ?? 32
  const width = opts.width ?? 900
  const padding = fontSize
  const canvas = document.createElement('canvas')
  // Estimate height: rough line count + padding.
  const lineCount = Math.max(1, Math.ceil(text.length / Math.floor(width / fontSize)))
  canvas.width = width
  canvas.height = padding * 2 + fontSize * 1.5 * lineCount
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.fillStyle = opts.background ?? '#0d1217'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = opts.color ?? '#f5f5f5'
  ctx.font = `${fontSize}px "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif`
  ctx.textBaseline = 'top'
  // Naive word-wrap: just measure char-by-char.
  let y = padding
  let line = ''
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > width - padding * 2) {
      ctx.fillText(line, padding, y)
      y += fontSize * 1.5
      line = ch
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, padding, y)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  )
  if (!blob) throw new Error('canvas toBlob failed')
  return blob.arrayBuffer()
}
import {
  Channels,
  type SourceStatus,
  type SharedWordGroup,
  type SharedJmdictEntry,
  type SharedLookupResult,
  type SharedWindowSource,
  type SharedRegion,
  type CaptureFramePayload,
  type OverlayMode,
  type PopupShowPayload
} from '@shared/ipc'

const vnr = {
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send(Channels.overlaySetIgnore, { ignore })
  },
  devPaste: (line: string): void => {
    ipcRenderer.send(Channels.devPaste, line)
  },
  tokenize: (line: string): Promise<SharedWordGroup[]> => {
    return ipcRenderer.invoke(Channels.tokenizeLine, line)
  },
  lookup: (form: string): Promise<SharedJmdictEntry[]> => {
    return ipcRenderer.invoke(Channels.dictLookup, form)
  },
  lookupGroup: (group: SharedWordGroup): Promise<SharedLookupResult> => {
    return ipcRenderer.invoke(Channels.dictLookupWithDeinflect, group)
  },
  listWindows: (): Promise<SharedWindowSource[]> => {
    return ipcRenderer.invoke(Channels.captureListWindows)
  },
  setSource: (sourceId: string): void => {
    ipcRenderer.send(Channels.captureSetSource, sourceId)
  },
  stopCapture: (): void => {
    ipcRenderer.send(Channels.captureStop)
  },
  captureFrame: (payload: CaptureFramePayload): void => {
    ipcRenderer.send(Channels.captureFrame, payload)
  },
  getRegion: (windowName: string): Promise<SharedRegion | null> => {
    return ipcRenderer.invoke(Channels.regionsGet, windowName)
  },
  setRegion: (windowName: string, region: SharedRegion): Promise<void> => {
    return ipcRenderer.invoke(Channels.regionsSet, { windowName, region })
  },
  devOcrTest: (png: ArrayBuffer): Promise<string> => {
    return ipcRenderer.invoke(Channels.devOcrTest, png)
  },
  devRenderAndOcr: async (text: string, options?: DevRenderOptions): Promise<string> => {
    const png = await renderTextToPng(text, options)
    return ipcRenderer.invoke(Channels.devOcrTest, png)
  },
  openTestVN: (): void => {
    ipcRenderer.send(Channels.devOpenTestVN)
  },
  popupShow: (payload: PopupShowPayload): void => {
    ipcRenderer.send(Channels.popupShow, payload)
  },
  popupHide: (): void => {
    ipcRenderer.send(Channels.popupHide)
  },
  setOverlayMode: (mode: OverlayMode): void => {
    ipcRenderer.send(Channels.overlaySetMode, mode)
  },
  onLine: (cb: (line: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, line: string): void => cb(line)
    ipcRenderer.on(Channels.textLine, listener)
    return () => {
      ipcRenderer.removeListener(Channels.textLine, listener)
    }
  },
  onStatus: (cb: (s: SourceStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: SourceStatus): void => cb(s)
    ipcRenderer.on(Channels.textStatus, listener)
    return () => {
      ipcRenderer.removeListener(Channels.textStatus, listener)
    }
  }
}

console.log('[vnr preload] loading; contextIsolated =', process.contextIsolated)

try {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('vnr', vnr)
    console.log('[vnr preload] bridge exposed: electron, vnr')
  } else {
    // @ts-ignore — defined in index.d.ts
    window.electron = electronAPI
    // @ts-ignore — defined in index.d.ts
    window.vnr = vnr
    console.log('[vnr preload] direct-attach: electron, vnr')
  }
} catch (error) {
  console.error('[vnr preload] expose failed:', error)
}
