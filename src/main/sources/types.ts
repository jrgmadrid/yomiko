import { EventEmitter } from 'node:events'

export type SourceStatus = 'connected' | 'reconnecting' | 'disconnected'

export type TextSourceEvents = {
  text: [line: string]
  status: [status: SourceStatus]
}

export abstract class TextSource extends EventEmitter<TextSourceEvents> {
  abstract readonly id: string
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
}
