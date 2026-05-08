import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { Channels } from '../main/ipc/channels'

const vnr = {
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send(Channels.overlaySetIgnore, { ignore })
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
