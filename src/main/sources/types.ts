import { EventEmitter } from 'node:events'
import type { OcrResult } from '../ocr/types'
import type { Orientation, SharedRegion } from '@shared/ipc'

export type SourceStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface FrameOcrData {
  result: OcrResult
  region: SharedRegion
  /** Source PNG fed to the OCR backend. Held by the main process so it can
   *  re-crop around a hovered line for VLM translation without re-capturing. */
  png: Buffer
  /** Renderer's pre-OCR orientation hint. 'vertical' means the renderer
   *  pre-rotated the PNG 90° CCW; main must un-rotate bboxes before
   *  building hover zones for the actual on-screen text. */
  orientation: Orientation
}

export type TextSourceEvents = {
  text: [line: string]
  status: [status: SourceStatus]
  // OCR sources emit this after a successful recognize() so consumers can
  // build hover zones / sentence-mining context from the structured result.
  'frame-ocr': [data: FrameOcrData]
}

export abstract class TextSource extends EventEmitter<TextSourceEvents> {
  abstract readonly id: string
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
}
