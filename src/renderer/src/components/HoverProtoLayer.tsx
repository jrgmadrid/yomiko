import { useEffect, useState } from 'react'
import type {
  HoverZone,
  HoverZonePayload,
  RegionTranslationPayload,
  SharedLookupResult,
  SharedScreenRect,
  SharedWordGroup
} from '@shared/ipc'
import { Popup } from './Popup'

interface Props {
  /** Render visible per-character + per-token rectangles for alignment eyeballing. */
  debug?: boolean
  /** Latest hover-zone payload, owned by App so it survives hover-mode toggles. */
  payload: HoverZonePayload | null
}

interface HoveredState {
  zone: HoverZone
  el: HTMLElement
}

interface Tokenization {
  lineIdx: number
  // frameId is part of the identity: lineIdx is just a positional slot
  // (a single-dialogue VN always has its line at lineIdx=0 across every
  // frame), so without frameId we can't tell "same line position" from
  // "same line content."
  frameId: number
  groups: SharedWordGroup[]
}

interface StampedLookup {
  zoneId: number
  frameId: number
  result: SharedLookupResult
}

// Yomitan-style hover dwell before firing a translation. Combined with the
// VLM roundtrip (~1s), total first-paint is ~1.25s. A "translate now" hotkey
// is the planned escape hatch for confirmed-stable text.
const HOVER_TRANSLATE_DELAY_MS = 250

export function HoverProtoLayer({ debug = false, payload }: Props): React.JSX.Element | null {
  const [hovered, setHovered] = useState<HoveredState | null>(null)
  const [translation, setTranslation] = useState<RegionTranslationPayload | null>(null)
  const [tokenization, setTokenization] = useState<Tokenization | null>(null)
  const [lookupStamped, setLookupStamped] = useState<StampedLookup | null>(null)
  // Shift gates the dictionary popup. Default-on hover is the translation
  // overlay (yomiko's USP — image-on-game VLM translation, nothing else in
  // the space does it). Dict drilldown lives behind a modifier so the
  // common case is one card on screen, not two. Yomitan-idiom: scan-with-
  // modifier, inverted because here the dict is the opt-in, not the
  // default. The overlay window is focusable:false, so keydown listeners
  // don't fire — we sample shift state off mouse events (which fire on the
  // pointer-events-auto zones). React bails on identical setState values,
  // so onMouseMove → setShiftHeld is cheap even at high frequency.
  const [shiftHeld, setShiftHeld] = useState(false)

  const hoveredLineIdx = hovered?.zone.lineIdx
  const currentFrameId = payload?.frameId

  // Debounced per-line VLM trigger. Cleanup cancels the timer when the user
  // moves to a different line (or off entirely) before the dwell expires —
  // don't bill OpenRouter for fly-over hovers. Same lineIdx across token
  // changes leaves the deps stable, so token-to-token panning doesn't refire.
  useEffect(() => {
    if (hoveredLineIdx === undefined || currentFrameId === undefined) return
    const handle = setTimeout(() => {
      window.vnr.translateRegion({ frameId: currentFrameId, lineIdx: hoveredLineIdx })
    }, HOVER_TRANSLATE_DELAY_MS)
    return () => clearTimeout(handle)
  }, [hoveredLineIdx, currentFrameId])

  // Receive translation results unconditionally; render gates on lineIdx
  // match so stale responses can't display under a different hover.
  useEffect(() => {
    return window.vnr.onRegionTranslation(setTranslation)
  }, [])

  // Tokenize the VLM text once per (frameId, lineIdx, text). The dictionary
  // popup then resolves against this tokenization, not Vision's first-pass —
  // which is exactly the fix for Vision's substitution bias on the hovered
  // word. frameId is stamped so a stale tokenization (from a previous frame
  // at the same lineIdx) can be recognized and ignored.
  useEffect(() => {
    if (!translation) return
    let cancelled = false
    void window.vnr.tokenize(translation.text).then((groups) => {
      if (!cancelled) {
        setTokenization({
          lineIdx: translation.lineIdx,
          frameId: translation.frameId,
          groups
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [translation])

  // Resolve the dictionary entry for the hovered token using the VLM-
  // tokenized line. Gated on shiftHeld: don't pay for the kuromoji+sqlite
  // roundtrip when the user isn't asking for the popup. Effect re-fires
  // when shift is pressed mid-hover, so the popup appears in ~50ms.
  //
  // Position-anchored: find the group whose [start,end] matches (or
  // contains) the hovered zone's [start,end]. For same-length substitutions
  // (the named failure mode) this hits exact match and picks up the
  // corrected surface. For length-changing diffs it falls back to the
  // enclosing group, which is usually still right.
  useEffect(() => {
    if (!shiftHeld) return
    if (currentFrameId === undefined) return
    if (!hovered || !tokenization || tokenization.lineIdx !== hovered.zone.lineIdx) return
    // Tokenization may be from a previous frame whose lineIdx happens to
    // collide with the current frame's. Skip until fresh tokenization for
    // the current frame arrives.
    if (tokenization.frameId !== currentFrameId) return
    const corrected = findGroupSpanning(tokenization.groups, hovered.zone.start, hovered.zone.end)
    if (!corrected) return
    const zoneIdAtFire = hovered.zone.id
    const frameIdAtFire = currentFrameId
    let cancelled = false
    void window.vnr.lookupGroup(corrected).then((r) => {
      if (!cancelled) {
        setLookupStamped({ zoneId: zoneIdAtFire, frameId: frameIdAtFire, result: r })
      }
    })
    return () => {
      cancelled = true
    }
  }, [shiftHeld, hovered, tokenization, currentFrameId])

  if (!payload) return null

  const lineRect = hovered ? unionLineRect(payload.zones, hovered.zone.lineIdx) : null
  // Both fresh-gates check frameId AND a positional id (lineIdx for
  // translation, zoneId for lookup). Positional ids alone get reused across
  // frames — a single-dialogue VN's line is always at lineIdx=0, the first
  // zone always at zoneId=0 — so without the frameId check, the held state
  // from a previous frame shows under the next frame's hover.
  const translationFresh =
    hovered &&
    translation &&
    translation.lineIdx === hovered.zone.lineIdx &&
    translation.frameId === payload.frameId
      ? translation
      : null
  const lookupFresh =
    hovered &&
    lookupStamped &&
    lookupStamped.zoneId === hovered.zone.id &&
    lookupStamped.frameId === payload.frameId
      ? lookupStamped.result
      : null

  return (
    <div className="pointer-events-none fixed inset-0">
      {debug &&
        payload.debugChars.map((c, i) => (
          <div
            key={`c${i}`}
            className="absolute border border-red-400/70 bg-red-400/10"
            style={{
              left: c.rect.x,
              top: c.rect.y,
              width: c.rect.w,
              height: c.rect.h
            }}
          />
        ))}
      {payload.zones.map((z) => (
        <div
          key={z.id}
          className={`hit pointer-events-auto absolute ${
            debug ? 'border-2 border-emerald-400/80 bg-emerald-400/10' : ''
          }`}
          style={{
            left: z.rect.x,
            top: z.rect.y,
            width: z.rect.w,
            height: z.rect.h,
            cursor: 'help'
          }}
          onMouseEnter={(e) => {
            setHovered({ zone: z, el: e.currentTarget })
            setShiftHeld(e.shiftKey)
          }}
          onMouseMove={(e) => setShiftHeld(e.shiftKey)}
          onMouseLeave={() => setHovered(null)}
        />
      ))}
      {hovered && lineRect && (
        <div
          className="absolute max-w-[640px] min-w-[160px] rounded-lg border border-white/10 bg-black/85 px-3 py-2 text-sm leading-relaxed text-white shadow-2xl backdrop-blur"
          style={{
            left: Math.max(8, lineRect.x),
            top: lineRect.y + lineRect.h + 8
          }}
        >
          {translationFresh ? (
            <>
              <div className="text-[11px] tracking-wide text-white/45">
                {translationFresh.text}
              </div>
              <div className="mt-1">{translationFresh.translation}</div>
            </>
          ) : (
            <div
              className="vnr-shimmer h-[1.1em] rounded-md"
              style={{ width: Math.min(360, Math.max(120, lineRect.w)) }}
            />
          )}
        </div>
      )}
      {hovered && shiftHeld && <Popup data={lookupFresh} anchor={hovered.el} />}
    </div>
  )
}

// Find the tokenized group corresponding to a Vision-derived hover zone.
// Preference order:
//   1. Exact boundary match — substitution at same indices (the common fix)
//   2. Enclosing group — VLM tokenizer made a coarser word boundary
//   3. Any overlapping group — best-effort fallback for length-changing diffs
function findGroupSpanning(
  groups: SharedWordGroup[],
  start: number,
  end: number
): SharedWordGroup | null {
  for (const g of groups) {
    if (g.start === start && g.end === end) return g
  }
  for (const g of groups) {
    if (g.start <= start && g.end >= end) return g
  }
  for (const g of groups) {
    if (g.end > start && g.start < end) return g
  }
  return null
}

// Union of all zone rects on a single line. Used to anchor the translation
// overlay to the line's bottom-left, not to the hovered token (which would
// jitter as the user moves across tokens).
function unionLineRect(zones: HoverZone[], lineIdx: number): SharedScreenRect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let any = false
  for (const z of zones) {
    if (z.lineIdx !== lineIdx) continue
    any = true
    minX = Math.min(minX, z.rect.x)
    minY = Math.min(minY, z.rect.y)
    maxX = Math.max(maxX, z.rect.x + z.rect.w)
    maxY = Math.max(maxY, z.rect.y + z.rect.h)
  }
  if (!any) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
