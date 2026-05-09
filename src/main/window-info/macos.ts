import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

// Bounds in macOS screen DIPs (top-left origin) — matches BrowserWindow.getBounds().
export interface WindowBounds {
  id: number
  x: number
  y: number
  w: number
  h: number
  ownerName: string
}

interface SidecarOk {
  id: number
  bounds: [number, number, number, number]
  name: string
}

interface SidecarErr {
  id: number | null
  error: string
}

type SidecarOutput = SidecarOk | SidecarErr

interface PendingRequest {
  resolve: (b: WindowBounds | null) => void
  reject: (e: Error) => void
}

// Spawns the macos-window-info Swift sidecar and serializes lookup() calls
// over its line-based stdin / NDJSON stdout protocol.
export class MacWindowInfo {
  private proc: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private queue: PendingRequest[] = []
  private starting: Promise<void> | null = null

  private binPath(): string {
    if (is.dev) {
      return resolve(app.getAppPath(), 'resources', 'bin', 'macos-window-info')
    }
    return resolve(process.resourcesPath, 'bin', 'macos-window-info')
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
          if (msg) console.error('[window-info]', msg)
        })
        proc.on('exit', (code) => {
          this.proc = null
          this.stdoutBuffer = ''
          for (const p of this.queue) {
            p.reject(new Error(`window-info sidecar exited (code=${code})`))
          }
          this.queue = []
        })
        proc.on('error', (err) => rejectStart(err))
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
        console.warn('[window-info] orphan output:', raw)
        continue
      }
      try {
        const parsed = JSON.parse(raw) as SidecarOutput
        if ('error' in parsed) {
          pending.resolve(null)
        } else {
          const [x, y, w, h] = parsed.bounds
          pending.resolve({ id: parsed.id, x, y, w, h, ownerName: parsed.name })
        }
      } catch (err) {
        pending.reject(new Error(`bad sidecar output: ${raw} (${(err as Error).message})`))
      }
    }
  }

  async lookup(windowId: number): Promise<WindowBounds | null> {
    await this.start()
    if (!this.proc) throw new Error('window-info sidecar unavailable')
    return new Promise<WindowBounds | null>((resolveReq, rejectReq) => {
      this.queue.push({ resolve: resolveReq, reject: rejectReq })
      try {
        this.proc!.stdin.write(`${windowId}\n`)
      } catch (err) {
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
        // already dead
      }
      this.proc = null
    }
  }
}
