import { resolve } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { JsonLineSidecar, lengthPrefixed } from './sidecar'
import type { OcrBackend, OcrLine, OcrResult } from './types'

interface SidecarOutput {
  lines?: string[]
  error?: string
}

const ZERO_RECT = { x: 0, y: 0, w: 0, h: 0 }

function binPath(): string {
  const root = is.dev ? app.getAppPath() : process.resourcesPath
  return resolve(root, is.dev ? 'resources/bin/windows-media-ocr.exe' : 'bin/windows-media-ocr.exe')
}

// Mirrors AppleVisionBackend's protocol exactly. The Win sidecar emits
// text-only lines pre-bbox extension; chars/rect stay zeroed until the
// Program.cs side starts emitting per-line bounding boxes.
export class WindowsMediaBackend
  extends JsonLineSidecar<SidecarOutput>
  implements OcrBackend
{
  readonly id = 'windows-media'

  constructor() {
    super({ label: 'windows-media', binPath })
  }

  protected parseResponse(json: unknown): SidecarOutput {
    return json as SidecarOutput
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    const out = await this.send(lengthPrefixed(png))
    if (out.error) throw new Error(out.error)
    const lines = (out.lines ?? []).map(
      (text): OcrLine => ({ text, rect: ZERO_RECT, chars: [] })
    )
    // Win sidecar doesn't return bboxes yet; image dims unused downstream
    // since there are no rects to un-rotate.
    return { lines, imageWidth: 0, imageHeight: 0 }
  }
}
