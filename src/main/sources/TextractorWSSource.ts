import { WebSocket } from 'ws'
import { TextSource } from './types'

export interface TextractorWSConfig {
  host: string
  port: number
}

// Connects to kuroahna's textractor_websocket extension (default 0.0.0.0:6677,
// inside the Wine prefix on Mac via Whisky/CrossOver, native on Win). The
// server starts lazily — only after Textractor selects a non-Clipboard thread
// and produces a line — so initial ECONNREFUSED is expected; we treat the
// whole pre-connection state as 'reconnecting' rather than 'disconnected'.
//
// Payload is plain text (no JSON, no metadata). One message = one line.
export class TextractorWSSource extends TextSource {
  readonly id = 'textractor-ws'

  private ws: WebSocket | null = null
  private stopping = false
  private backoffMs = 500
  private readonly maxBackoffMs = 10_000
  private lastLine = ''
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(private readonly config: TextractorWSConfig) {
    super()
  }

  async start(): Promise<void> {
    this.stopping = false
    this.connect()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
    this.emit('status', 'disconnected')
  }

  private connect(): void {
    if (this.stopping) return
    const url = `ws://${this.config.host}:${this.config.port}`
    this.emit('status', 'reconnecting')

    const ws = new WebSocket(url)
    this.ws = ws

    ws.on('open', () => {
      this.backoffMs = 500
      this.emit('status', 'connected')
    })

    ws.on('message', (raw) => {
      const text = Array.isArray(raw)
        ? Buffer.concat(raw as Buffer[]).toString('utf8')
        : raw.toString()
      const line = text.trim()
      if (!line || line === this.lastLine) return
      this.lastLine = line
      this.emit('text', line)
    })

    // 'error' fires before 'close'; we let 'close' drive the reconnect path.
    ws.on('error', () => {})

    ws.on('close', () => {
      this.ws = null
      if (this.stopping) return
      this.emit('status', 'reconnecting')
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
