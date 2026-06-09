import { AppleVisionBackend } from './apple-vision'
import { WindowsMediaBackend } from './windows-media'
import type { OcrBackend } from './types'

let backend: OcrBackend | null = null

/** Lazily create the platform OCR backend. Returns null on platforms with
 *  no backend (Linux). */
export function getOrCreateOcrBackend(): OcrBackend | null {
  if (backend) return backend
  if (process.platform === 'darwin') backend = new AppleVisionBackend()
  else if (process.platform === 'win32') backend = new WindowsMediaBackend()
  return backend
}
