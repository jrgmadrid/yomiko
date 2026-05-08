import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { OcrBackend } from './types'

interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
}

interface SidecarOutput {
  lines?: string[]
  ts?: number
  error?: string
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
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      const pending = this.queue.shift()
      if (!pending) {
        console.warn('[apple-vision] orphan output:', line)
        continue
      }
      try {
        const parsed = JSON.parse(line) as SidecarOutput
        if (parsed.error) {
          pending.reject(new Error(parsed.error))
        } else {
          pending.resolve((parsed.lines ?? []).join('\n'))
        }
      } catch (err) {
        pending.reject(new Error(`bad sidecar output: ${line} (${(err as Error).message})`))
      }
    }
  }

  async recognize(png: Buffer): Promise<string> {
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

    return new Promise<string>((resolveReq, rejectReq) => {
      this.queue.push({ resolve: resolveReq, reject: rejectReq })
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
