import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  Channels,
  type SourceStatus,
  type SharedWordGroup,
  type SharedJmdictEntry
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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('vnr', vnr)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore — defined in index.d.ts
  window.electron = electronAPI
  // @ts-ignore — defined in index.d.ts
  window.vnr = vnr
}
