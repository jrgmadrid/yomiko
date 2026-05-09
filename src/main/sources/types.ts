import { EventEmitter } from 'node:events'
import type { OcrResult } from '../ocr/types'
import type { SharedRegion } from '@shared/ipc'

export type SourceStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface FrameOcrData {
  result: OcrResult
  region: SharedRegion
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
