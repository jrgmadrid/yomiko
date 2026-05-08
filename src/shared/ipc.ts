export const Channels = {
  overlaySetIgnore: 'overlay:set-ignore',
  textLine: 'text:line',
  textStatus: 'text:status',
  devPaste: 'dev:paste',
  tokenizeLine: 'tokenize:line',
  dictLookup: 'dict:lookup',
  dictLookupWithDeinflect: 'dict:lookup-with-deinflect',
  captureListWindows: 'capture:list-windows',
  captureSetSource: 'capture:set-source',
  captureFrame: 'capture:frame',
  captureStop: 'capture:stop',
  captureStatus: 'capture:status',
  regionsGet: 'regions:get',
  regionsSet: 'regions:set'
} as const

export type ChannelName = (typeof Channels)[keyof typeof Channels]

export type SetIgnorePayload = { ignore: boolean }

export type SourceStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface SharedToken {
  surface: string
  reading: string
  lemma: string
  pos: string
  posDetail: string
  cType: string
  cForm: string
  start: number
  end: number
}

export interface SharedWordGroup {
  surface: string
  reading: string
  headLemma: string
  headPos: string
  start: number
  end: number
  tokens: SharedToken[]
}

export interface SharedJmdictGloss {
  lang: string
  text: string
  type?: string
}

export interface SharedJmdictSense {
  partOfSpeech: string[]
  field: string[]
  misc: string[]
  info: string[]
  gloss: SharedJmdictGloss[]
}

export interface SharedJmdictEntry {
  id: number
  kanji: { common: boolean; text: string }[]
  kana: { common: boolean; text: string }[]
  senses: SharedJmdictSense[]
  matchedForm: string
  matchedIsKanji: boolean
}

export interface SharedDeinflectionStep {
  description: string
}

export interface SharedLookupResult {
  matched: string
  chain: SharedDeinflectionStep[]
  entries: SharedJmdictEntry[]
}

export interface SharedWindowSource {
  id: string
  name: string
  thumbnailDataUrl: string
}

export interface SharedRegion {
  x: number
  y: number
  w: number
  h: number
}

export type CaptureStatus = 'idle' | 'starting' | 'streaming' | 'error'

export interface CaptureFramePayload {
  data: ArrayBuffer
  region: SharedRegion
  ts: number
  /** 64-bit dHash of the cropped frame as a 16-char lowercase hex string. */
  hash: string
}
