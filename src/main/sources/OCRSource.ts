import { TextSource } from './types'
import { Stabilizer } from '../ocr/stabilizer'
import { Deduper } from '../ocr/dedupe'
import { hammingDistance } from '../ocr/hamming'
import { refineResult } from '../ocr/refine'
import { ocrResultToText, type OcrBackend } from '../ocr/types'
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
  private frameCount = 0
  private prevHash: string | null = null
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
    this.frameCount += 1

    if (!this.hasReceivedFrame) {
      this.hasReceivedFrame = true
      this.emit('status', 'connected')
      console.log('[ocr-source] first frame; hash=', payload.hash)
    }

    // Log every frame whose hash differs from the previous (capture motion).
    if (this.prevHash !== null && this.prevHash !== payload.hash) {
      const dist = hammingDistance(payload.hash, this.prevHash)
      console.log(
        `[ocr-source] frame ${this.frameCount}: Δ=${dist} bits  hash=${payload.hash.slice(0, 16)}…`
      )
    }
    this.prevHash = payload.hash

    const event = this.stabilizer.observe(payload.hash, payload.ts)
    if (event.type !== 'fire') return

    if (this.inFlight > 0) return
    this.inFlight += 1
    console.log(
      `[ocr-source] FIRE @frame ${this.frameCount}; bytes=${payload.data.byteLength} hash=${payload.hash}`
    )
    try {
      const png = Buffer.from(payload.data)
      const firstPass = await this.backend.recognize(png)
      const result = await refineResult(png, firstPass, this.backend)
      const trimmed = ocrResultToText(result).trim()
      if (!trimmed) {
        console.log('[ocr-source] empty OCR result')
        return
      }
      // Always emit frame-ocr: hover-zone consumers want every OCR result
      // (the renderer might have toggled into hover mode after the last text
      // change). Dedupe still gates the textLine emit.
      this.emit('frame-ocr', { result, region: payload.region, png, orientation: payload.orientation })
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
