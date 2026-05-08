import { TextSource } from './types'
import { Stabilizer } from '../ocr/stabilizer'
import { Deduper } from '../ocr/dedupe'
import type { OcrBackend } from '../ocr/types'
import type { CaptureFramePayload } from '@shared/ipc'

// Glues the renderer-side capture pipeline to an OCR backend.
//
// Frames arrive via IPC at ~5fps with their pre-computed dHash. The
// stabilizer decides when to spend an OCR call (only on stable changes,
// rate-limited per dHash bucket). On hit, we ship the cropped PNG to the
// backend, then run the result through the deduper before emitting.
export class OCRSource extends TextSource {
  readonly id = 'ocr'

  private active = false
  private hasReceivedFrame = false
  private inFlight = 0
  private readonly stabilizer = new Stabilizer()
  private readonly deduper = new Deduper()

  constructor(private readonly backend: OcrBackend) {
    super()
  }

  async start(): Promise<void> {
    this.active = true
    this.hasReceivedFrame = false
    this.stabilizer.reset()
    this.deduper.reset()
    this.emit('status', 'reconnecting')
  }

  async stop(): Promise<void> {
    this.active = false
    this.emit('status', 'disconnected')
    await this.backend.close()
  }

  async ingestFrame(payload: CaptureFramePayload): Promise<void> {
    if (!this.active) return

    if (!this.hasReceivedFrame) {
      this.hasReceivedFrame = true
      this.emit('status', 'connected')
      console.log('[ocr-source] first frame received, hash=', payload.hash.slice(0, 12))
    }

    const event = this.stabilizer.observe(payload.hash, payload.ts)
    if (event.type !== 'fire') return

    if (this.inFlight > 0) return
    this.inFlight += 1
    console.log('[ocr-source] firing OCR; bytes=', payload.data.byteLength, 'hash=', payload.hash.slice(0, 12))
    try {
      const text = await this.backend.recognize(Buffer.from(payload.data))
      const trimmed = text.trim()
      if (!trimmed) {
        console.log('[ocr-source] empty OCR result')
        return
      }
      if (this.deduper.shouldEmit(trimmed)) {
        console.log('[ocr-source] emit:', trimmed)
        this.emit('text', trimmed)
      } else {
        console.log('[ocr-source] dedupe suppressed:', trimmed)
      }
    } catch (err) {
      console.error('[ocr-source] recognize failed:', (err as Error).message)
    } finally {
      this.inFlight -= 1
    }
  }
}
