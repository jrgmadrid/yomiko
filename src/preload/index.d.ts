import { ElectronAPI } from '@electron-toolkit/preload'
import {
  SourceStatus,
  SharedWordGroup,
  SharedJmdictEntry,
  SharedLookupResult,
  SharedWindowSource,
  SharedRegion,
  CaptureFramePayload
} from '@shared/ipc'

export interface VnrApi {
  setIgnoreMouseEvents: (ignore: boolean) => void
  devPaste: (line: string) => void
  tokenize: (line: string) => Promise<SharedWordGroup[]>
  lookup: (form: string) => Promise<SharedJmdictEntry[]>
  lookupGroup: (group: SharedWordGroup) => Promise<SharedLookupResult>
  listWindows: () => Promise<SharedWindowSource[]>
  setSource: (sourceId: string) => void
  stopCapture: () => void
  captureFrame: (payload: CaptureFramePayload) => void
  getRegion: (windowName: string) => Promise<SharedRegion | null>
  setRegion: (windowName: string, region: SharedRegion) => Promise<void>
  onLine: (cb: (line: string) => void) => () => void
  onStatus: (cb: (s: SourceStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    vnr: VnrApi
  }
}
