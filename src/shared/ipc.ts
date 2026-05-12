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
  regionsSet: 'regions:set',
  devOcrTest: 'dev:ocr-test',
  devOpenTestVN: 'dev:open-test-vn',
  hoverZones: 'hover:zones',
  hoverHotkey: 'hover:hotkey',
  translateRegion: 'translate:region',
  regionTranslation: 'region:translation',
  forceTranslation: 'force:translation'
} as const

/** Main → renderer: full-frame VLM translate driven by the Cmd+Shift+T
 *  hotkey. Three-state machine: `start` shows the loading state in the
 *  centered overlay, `result` fills it with content, `dismiss` hides it.
 *  Main tracks shown/hidden so a second hotkey press during an in-flight
 *  fetch drops the eventual result on the floor rather than popping the
 *  overlay back open. */
export type ForceTranslationEvent =
  | { kind: 'start' }
  | { kind: 'result'; text: string; translation: string }
  | { kind: 'dismiss' }

/** Renderer → main: asks the VLM to transcribe+translate the region around
 *  a hovered line. The main process validates `frameId` against its latest
 *  captured frame and silently drops the request if stale (a newer frame
 *  has arrived since the hover started). */
export interface TranslateRegionRequest {
  frameId: number
  lineIdx: number
}

/** Main → renderer: VLM result for a specific hover. The renderer matches
 *  `frameId + lineIdx` against the currently-hovered zone to ignore stale
 *  responses (the user has since moved off the hovered line). */
export interface RegionTranslationPayload {
  frameId: number
  lineIdx: number
  /** VLM-transcribed Japanese text. May differ from Apple Vision's first-pass
   *  (the divergence is the value-add — VLM fixes substitution and vocab
   *  gaps). */
  text: string
  /** English translation produced in the same VLM call. */
  translation: string
}

export type HoverHotkey = 'toggle-mode' | 'toggle-debug' | 'toggle-vertical'

/** Source text orientation. 'vertical' means tategaki — the renderer
 *  pre-rotates the captured frame 90° CCW before OCR so Vision (poor on
 *  vertical Japanese) sees horizontal text. Main rotates bboxes back. */
export type Orientation = 'horizontal' | 'vertical'

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
  /** Indicates the renderer pre-rotated the PNG so main can rotate bboxes
   *  back. 'horizontal' means data is in original orientation. */
  orientation: Orientation
}

/** A rectangle in overlay-window CSS pixels (top-left origin, post-DPR). */
export interface SharedScreenRect {
  x: number
  y: number
  w: number
  h: number
}

/** A per-token clickable region positioned over the captured window's text. */
export interface HoverZone {
  /** Stable id within the frame so React can key and skip rerenders. */
  id: number
  /** Index into OcrResult.lines this zone belongs to. Used as the routing
   *  key for translateRegion (which line to crop + send to the VLM). */
  lineIdx: number
  /** Token surface (joined kanji/kana). */
  surface: string
  /** Char offsets in lineText (inclusive start, exclusive end). */
  start: number
  end: number
  /** Rectangle in overlay-window CSS pixels — drop straight into `style.left/top`. */
  rect: SharedScreenRect
  /** Word group for direct lookup via dictLookupWithDeinflect. */
  group: SharedWordGroup
}

/** Per-character debug rectangles, drawn when hover-debug mode is on. */
export interface HoverDebugChar {
  text: string
  rect: SharedScreenRect
}

export interface HoverZonePayload {
  /** Monotonic frame counter so the renderer can drop stale frames. */
  frameId: number
  /** Original line text — useful for sentence-mining downstream. */
  lineText: string
  zones: HoverZone[]
  /** Per-character rects for debug visualization. */
  debugChars: HoverDebugChar[]
}
