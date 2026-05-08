import { TextSource } from './types'

export class ManualPasteSource extends TextSource {
  readonly id = 'manual-paste'

  async start(): Promise<void> {
    this.emit('status', 'connected')
  }

  async stop(): Promise<void> {
    this.emit('status', 'disconnected')
  }

  feed(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    this.emit('text', trimmed)
  }
}
