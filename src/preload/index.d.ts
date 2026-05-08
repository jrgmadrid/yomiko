import { ElectronAPI } from '@electron-toolkit/preload'
import {
  SourceStatus,
  SharedWordGroup,
  SharedJmdictEntry,
  SharedLookupResult
} from '@shared/ipc'

export interface VnrApi {
  setIgnoreMouseEvents: (ignore: boolean) => void
  devPaste: (line: string) => void
  tokenize: (line: string) => Promise<SharedWordGroup[]>
  lookup: (form: string) => Promise<SharedJmdictEntry[]>
  lookupGroup: (group: SharedWordGroup) => Promise<SharedLookupResult>
  onLine: (cb: (line: string) => void) => () => void
  onStatus: (cb: (s: SourceStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    vnr: VnrApi
  }
}
