import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  Channels,
  type SourceStatus,
  type SharedWordGroup,
  type SharedJmdictEntry,
  type SharedLookupResult,
  type SharedWindowSource,
  type CaptureFramePayload
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
