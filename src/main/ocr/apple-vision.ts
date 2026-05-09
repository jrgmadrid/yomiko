import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { OcrBackend, OcrCharBox, OcrLine, OcrRect, OcrResult } from './types'

interface PendingRequest {
  resolve: (result: OcrResult) => void
  reject: (err: Error) => void
  imageWidth: number
  imageHeight: number
}

interface SidecarLine {
  text: string
  bbox: [number, number, number, number]
}

interface SidecarOutput {
  lines?: SidecarLine[]
  ts?: number
  error?: string
}

// .accurate is the only Vision recognitionLevel that produces results for
// Japanese — but boundingBox(for: Range) collapses every char in a "word"
// to the same line-level rect. Japanese has no spaces, so per-character
// rects from Vision are useless. Synthesize them by dividing the line
// bbox horizontally by character count. CJK fonts are near-monospace, so
// alignment is tight enough for hover hit zones.
function synthesizeCharRects(text: string, lineRect: OcrRect): OcrCharBox[] {
  const chars = [...text]
  const n = chars.length
  if (n === 0) return []
  const charW = lineRect.w / n
  return chars.map((c, i) => ({
    text: c,
    rect: {
      x: lineRect.x + i * charW,
      y: lineRect.y,
      w: charW,
      h: lineRect.h
    }
  }))
}

// PNG IHDR width is at byte 16, height at byte 20 (both big-endian u32).
function pngDimensions(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// Vision normalized rect (0–1, bottom-left origin) → image-pixel rect (top-left origin).
function normalizedToPixels(
  bbox: [number, number, number, number],
  imgW: number,
  imgH: number
): OcrRect {
  const [nx, ny, nw, nh] = bbox
  const w = nw * imgW
  const h = nh * imgH
  return {
    x: nx * imgW,
    y: imgH - ny * imgH - h,
    w,
    h
  }
}

// Spawns the macos-vision-ocr Swift sidecar and serializes recognize() calls
// over its length-prefixed stdin / NDJSON stdout protocol.
export class AppleVisionBackend implements OcrBackend {
  readonly id = 'apple-vision'

  private proc: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private queue: PendingRequest[] = []
  private starting: Promise<void> | null = null
  private restartCount = 0
  private readonly maxRestarts = 5

  private binPath(): string {
    if (is.dev) {
      return resolve(app.getAppPath(), 'resources', 'bin', 'macos-vision-ocr')
    }
    return resolve(process.resourcesPath, 'bin', 'macos-vision-ocr')
  }

  private start(): Promise<void> {
    if (this.proc) return Promise.resolve()
    if (this.starting) return this.starting

    this.starting = new Promise<void>((resolveStart, rejectStart) => {
      try {
        const proc = spawn(this.binPath(), [], { stdio: ['pipe', 'pipe', 'pipe'] })
        proc.stdout.setEncoding('utf8')
        proc.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
        proc.stderr.on('data', (chunk: Buffer) => {
          const msg = chunk.toString('utf8').trim()
          if (msg) console.error('[apple-vision]', msg)
        })
        proc.on('exit', (code) => {
          this.proc = null
          this.stdoutBuffer = ''
          // Fail any in-flight requests so callers can retry.
          for (const p of this.queue) {
            p.reject(new Error(`apple-vision sidecar exited (code=${code})`))
          }
          this.queue = []
        })
        proc.on('error', (err) => {
          rejectStart(err)
        })
        this.proc = proc
        resolveStart()
      } catch (err) {
        rejectStart(err as Error)
      }
    }).finally(() => {
      this.starting = null
    })

    return this.starting
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline === -1) break
      const raw = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!raw) continue
      const pending = this.queue.shift()
      if (!pending) {
        console.warn('[apple-vision] orphan output:', raw)
        continue
      }
      try {
        const parsed = JSON.parse(raw) as SidecarOutput
        if (parsed.error) {
          pending.reject(new Error(parsed.error))
        } else {
          const { imageWidth: w, imageHeight: h } = pending
          const lines = (parsed.lines ?? []).map((l): OcrLine => {
            const lineRect = normalizedToPixels(l.bbox, w, h)
            return {
              text: l.text,
              rect: lineRect,
              chars: synthesizeCharRects(l.text, lineRect)
            }
          })
          pending.resolve({ lines })
        }
      } catch (err) {
        pending.reject(new Error(`bad sidecar output: ${raw} (${(err as Error).message})`))
      }
    }
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    try {
      await this.start()
    } catch (err) {
      if (this.restartCount < this.maxRestarts) {
        this.restartCount += 1
        return this.recognize(png)
      }
      throw err
    }
    if (!this.proc) throw new Error('apple-vision sidecar unavailable')

    const { width, height } = pngDimensions(png)
    return new Promise<OcrResult>((resolveReq, rejectReq) => {
      this.queue.push({
        resolve: resolveReq,
        reject: rejectReq,
        imageWidth: width,
        imageHeight: height
      })
      const lengthPrefix = Buffer.alloc(4)
      lengthPrefix.writeUInt32BE(png.length, 0)
      try {
        this.proc!.stdin.write(lengthPrefix)
        this.proc!.stdin.write(png)
      } catch (err) {
        // stdin write failed — drain queue, will retry on next call.
        this.queue = this.queue.filter((p) => p !== this.queue[this.queue.length - 1])
        rejectReq(err as Error)
      }
    })
  }

  async close(): Promise<void> {
    if (this.proc) {
      try {
        this.proc.stdin.end()
        this.proc.kill()
      } catch {
        // Already dead — nothing to do.
      }
      this.proc = null
    }
  }
}
