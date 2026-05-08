import { ElectronAPI } from '@electron-toolkit/preload'

export interface VnrApi {
  setIgnoreMouseEvents: (ignore: boolean) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    vnr: VnrApi
  }
}
