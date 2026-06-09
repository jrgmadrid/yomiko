import {
  Channels,
  type RegionTranslationPayload,
  type TranslateRegionRequest
} from '@shared/ipc'
import { getLatestFrame, resolveLatchedLine } from '../frame-latch'
import { ocrResultToText } from '../ocr/types'
import { sendToOverlay } from '../window'
import { translateRegionImage } from './vlm'

export async function handleTranslateRegion(req: TranslateRegionRequest): Promise<void> {
  const resolved = resolveLatchedLine(req.frameId, req.lineIdx)
  if (!resolved.ok) {
    console.log(`[translate-region] ${resolved.message}; dropping`)
    return
  }
  const cacheKey = resolved.line.text.trim()
  console.log(
    `[translate-region] frame=${req.frameId} line=${req.lineIdx} crop=${resolved.crop.length}B firstPass="${cacheKey}"`
  )
  const result = await translateRegionImage(resolved.crop, cacheKey)
  if (!result) return
  const payload: RegionTranslationPayload = {
    frameId: req.frameId,
    lineIdx: req.lineIdx,
    text: result.text,
    translation: result.translation
  }
  sendToOverlay(Channels.regionTranslation, payload)
}

// Cmd+Shift+T → translate the entire latest frame, bypassing hover zones.
// Exists for the Vision-blind-spot case: stylized fonts, Buddhist mantra
// scenes, calligraphic title cards where Vision returns zero lines and the
// per-hover VLM path stays dormant because there's nothing to hover.
// Toggling: a second press dismisses; a press during an in-flight fetch
// cancels by dropping the eventual result. The flag is main-side because
// the hotkey arrives main-side and the cancel decision has to be too —
// the renderer can't drop a result main is about to dispatch.
let forceTranslateActive = false

export async function handleForceTranslate(): Promise<void> {
  if (forceTranslateActive) {
    forceTranslateActive = false
    sendToOverlay(Channels.forceTranslation, { kind: 'dismiss' })
    return
  }
  const frame = getLatestFrame()
  if (!frame) {
    console.warn('[force-translate] no frame in latch yet')
    return
  }
  forceTranslateActive = true
  sendToOverlay(Channels.forceTranslation, { kind: 'start' })
  const visionText = ocrResultToText(frame.result).trim()
  // When Vision found something, key by that for cross-frame dedupe.
  // When Vision found nothing (the named failure case this hotkey exists
  // for), fall back to frameId — intra-frame dedupe only, which still
  // covers "user pressed the hotkey twice in a row by accident."
  const cacheKey = `force:${visionText || `frame:${frame.frameId}`}`
  const result = await translateRegionImage(frame.png, cacheKey)
  if (!forceTranslateActive) return // user dismissed mid-fetch
  if (!result) {
    forceTranslateActive = false
    sendToOverlay(Channels.forceTranslation, { kind: 'dismiss' })
    return
  }
  sendToOverlay(Channels.forceTranslation, {
    kind: 'result',
    text: result.text,
    translation: result.translation
  })
}
