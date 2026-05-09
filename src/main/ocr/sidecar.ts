import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

// Shared scaffolding for "spawn-once persistent sidecar that speaks NDJSON
// over stdout" — covers both OCR sidecars (apple-vision, windows-media) and
// the macos-window-info bounds lookup. Subclasses define how to encode an
// outgoing request onto stdin and how to map one parsed JSON line to a
// resolved value.

interface PendingRequest<TRes> {
  resolve: (value: TRes) => void
  reject: (err: Error) => void
}

export interface SidecarOptions {
  binPath: () => string
  /** Tag used in console log lines and error messages. */
  label: string
}

export abstract class JsonLineSidecar<TRes> {
  private proc: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private queue: PendingRequest<TRes>[] = []
  private starting: Promise<void> | null = null

  constructor(private readonly opts: SidecarOptions) {}

  /**
   * Map one stdout JSON line to a result. Throw to reject the pending
   * request; return a value to resolve it.
   */
  protected abstract parseResponse(json: unknown): TRes

  /**
   * Send a request and wait for the next NDJSON line on stdout. The encoded
   * payload is whatever the subclass wants on the wire (length-prefixed PNG,
   * single line of text, etc.).
   */
  protected async send(payload: Buffer | string): Promise<TRes> {
    await this.start()
    const proc = this.proc
    if (!proc) throw new Error(`${this.opts.label} sidecar unavailable`)

    return new Promise<TRes>((resolveReq, rejectReq) => {
      const pending: PendingRequest<TRes> = { resolve: resolveReq, reject: rejectReq }
      this.queue.push(pending)
      try {
        proc.stdin.write(payload as string | Uint8Array)
      } catch (err) {
        const idx = this.queue.indexOf(pending)
        if (idx !== -1) this.queue.splice(idx, 1)
        rejectReq(err as Error)
      }
    })
  }

  private start(): Promise<void> {
    if (this.proc) return Promise.resolve()
    if (this.starting) return this.starting

    this.starting = new Promise<void>((resolveStart, rejectStart) => {
      const proc = spawn(this.opts.binPath(), [], { stdio: ['pipe', 'pipe', 'pipe'] })
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
      proc.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf8').trim()
        if (msg) console.error(`[${this.opts.label}]`, msg)
      })
      proc.on('exit', (code) => {
        this.proc = null
        this.stdoutBuffer = ''
        const err = new Error(`${this.opts.label} sidecar exited (code=${code})`)
        for (const p of this.queue) p.reject(err)
        this.queue = []
      })
      proc.on('error', (err) => rejectStart(err))
      this.proc = proc
      resolveStart()
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
        console.warn(`[${this.opts.label}] orphan output:`, raw)
        continue
      }
      try {
        pending.resolve(this.parseResponse(JSON.parse(raw)))
      } catch (err) {
        pending.reject(
          new Error(`[${this.opts.label}] bad output: ${raw} (${(err as Error).message})`)
        )
      }
    }
  }

  async close(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    try {
      proc.stdin.end()
      proc.kill()
    } catch {
      // Already exited.
    }
  }
}

/** Helper: encode a Buffer as `[u32-BE length][bytes]`. */
export function lengthPrefixed(payload: Buffer): Buffer {
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(payload.length, 0)
  return Buffer.concat([prefix, payload])
}
