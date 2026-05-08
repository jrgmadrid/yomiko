import { ElectronAPI } from '@electron-toolkit/preload'
import { SourceStatus, SharedWordGroup } from '@shared/ipc'

export interface VnrApi {
  setIgnoreMouseEvents: (ignore: boolean) => void
  devPaste: (line: string) => void
  tokenize: (line: string) => Promise<SharedWordGroup[]>
  onLine: (cb: (line: string) => void) => () => void
  onStatus: (cb: (s: SourceStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    vnr: VnrApi
  }
}
