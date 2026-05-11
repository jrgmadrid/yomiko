import { useCallback, useEffect, useRef, useState } from 'react'
import { attachClickThrough } from './lib/clickthrough'
import { TokenLine } from './components/TokenLine'
import { Popup } from './components/Popup'
import { SourcePicker } from './components/SourcePicker'
import { HoverProtoLayer } from './components/HoverProtoLayer'
import type { CaptureHandle } from './lib/capture'
import type {
  HoverZonePayload,
  SharedLookupResult,
  SharedWindowSource,
  SharedWordGroup,
  SourceStatus,
  TranslationPayload
} from '@shared/ipc'

interface RenderedLine {
  id: number
  text: string
  groups: SharedWordGroup[]
}

const HISTORY_LIMIT = 1
let nextLineId = 1

// Mirrors src/main/index.ts JAPANESE_REGEX. Inline here so the renderer can
// decide whether to expect a translation (and render a loading state) without
// piping per-line metadata through the IPC.
const JAPANESE_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/

function App(): React.JSX.Element {
  const [lines, setLines] = useState<RenderedLine[]>([])
  const [status, setStatus] = useState<SourceStatus>('disconnected')
  const [hoveredGroup, setHoveredGroup] = useState<SharedWordGroup | null>(null)
  const [hoveredAnchor, setHoveredAnchor] = useState<HTMLElement | null>(null)
  const [lookup, setLookup] = useState<SharedLookupResult | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeSource, setActiveSource] = useState<SharedWindowSource | null>(null)
  const captureRef = useRef<CaptureHandle | null>(null)
  const [hoverMode, setHoverMode] = useState(
    () => new URLSearchParams(window.location.search).get('hover') !== 'off'
  )
  const [hoverDebug, setHoverDebug] = useState(
    () => new URLSearchParams(window.location.search).get('hoverDebug') !== null
  )
  // Subscribed at App level (not inside HoverProtoLayer) so the payload
  // survives hover-mode toggles. OCRSource only fires once for static
  // windows like TextEdit; if HoverProtoLayer mounts after that single
  // emit, an internal subscription would never see it.
  const [hoverPayload, setHoverPayload] = useState<HoverZonePayload | null>(null)
  useEffect(() => window.vnr.onHoverZones(setHoverPayload), [])

  // Translation strip: keyed by source so we can drop stale translations
  // (line N+1 arrived before line N's translation came back).
  const [translation, setTranslation] = useState<TranslationPayload | null>(null)
  useEffect(() => window.vnr.onTranslation(setTranslation), [])

  useEffect(() => attachClickThrough(), [])

  useEffect(
    () =>
      window.vnr.onHoverHotkey((key) => {
        if (key === 'toggle-mode') setHoverMode((v) => !v)
        else if (key === 'toggle-debug') setHoverDebug((v) => !v)
      }),
    []
  )

  useEffect(
    () =>
      window.vnr.onLine(async (text) => {
        console.log('[overlay] text:line received:', text)
        // Clear any prior translation immediately so we don't briefly show
        // line N's translation under line N+1's source.
        setTranslation((cur) => (cur && cur.source === text ? cur : null))
        try {
          const groups = await window.vnr.tokenize(text)
          console.log('[overlay] tokenized', groups.length, 'groups')
          setLines((prev) =>
            [...prev, { id: nextLineId++, text, groups }].slice(-HISTORY_LIMIT)
          )
        } catch (err) {
          console.error('[overlay] tokenize failed:', err)
        }
      }),
    []
  )

  useEffect(() => window.vnr.onStatus(setStatus), [])

  useEffect(() => {
    if (!hoveredGroup) return
    let cancelled = false
    window.vnr.lookupGroup(hoveredGroup).then((result) => {
      if (!cancelled) setLookup(result)
    })
    return () => {
      cancelled = true
    }
  }, [hoveredGroup])

  useEffect(() => {
    return () => {
      if (captureRef.current) {
        captureRef.current.stop()
        captureRef.current = null
      }
    }
  }, [])

  const onHover = useCallback((group: SharedWordGroup, target: HTMLElement) => {
    setHoveredGroup(group)
    setHoveredAnchor(target)
  }, [])

  const onLeave = useCallback(() => {
    setHoveredGroup(null)
    setHoveredAnchor(null)
  }, [])

  const handleOpenPicker = (): void => {
    if (captureRef.current) {
      captureRef.current.stop()
      captureRef.current = null
    }
    setActiveSource(null)
    setPickerOpen(true)
  }

  const handlePickerConfirmed = (
    source: SharedWindowSource,
    _region: unknown,
    handle: CaptureHandle
  ): void => {
    captureRef.current = handle
    setActiveSource(source)
    setPickerOpen(false)
  }

  return (
    <>
      <div className="flex h-full w-full flex-col items-center justify-end p-6">
        <div className="hit flex max-h-[85vh] max-w-[92%] flex-col gap-2 overflow-hidden rounded-xl border border-white/5 bg-black/75 px-6 py-4 shadow-2xl backdrop-blur">
          <div className="flex shrink-0 items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-white/40">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${pipColor(status, activeSource)}`}
              />
              <span>{statusLabel(status, activeSource)}</span>
              {hoverMode && (
                <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-emerald-300">
                  hover{hoverDebug ? ' · debug' : ''}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleOpenPicker}
              className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] tracking-widest text-white/70 hover:bg-white/10"
            >
              {activeSource ? 'change source' : 'select source'}
            </button>
          </div>
          {!hoverMode && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {lines.length === 0 ? (
                <div className="text-base text-white/50">
                  {activeSource
                    ? `Watching ${activeSource.name} — waiting for text`
                    : 'Click "select source" to pick a VN window'}
                </div>
              ) : (
                lines.map((line) => (
                  <TokenLine
                    key={line.id}
                    groups={line.groups}
                    onHover={onHover}
                    onLeave={onLeave}
                  />
                ))
              )}
            </div>
          )}
          {(() => {
            const currentLine = lines[lines.length - 1]
            if (!currentLine || !JAPANESE_REGEX.test(currentLine.text)) return null
            const matched =
              translation && translation.source === currentLine.text ? translation : null
            // EN translation char count ≈ 1.5× source JP, but EN glyphs render
            // ~half as wide as JP, so total bar width tracks ~10px per source
            // char rather than naively scaling by the char-count ratio.
            // Clamped to keep short lines visible and long lines bounded.
            const skeletonPx = Math.min(480, Math.max(80, currentLine.text.length * 10))
            return (
              <div className="shrink-0 border-t border-white/10 pt-2 text-sm leading-relaxed">
                {matched ? (
                  <span className="text-white/60">{matched.text}</span>
                ) : (
                  <div
                    className="vnr-shimmer h-[1.1em] rounded-md"
                    style={{ width: `${skeletonPx}px` }}
                  />
                )}
              </div>
            )
          })()}
        </div>
        {lookup && hoveredAnchor && <Popup data={lookup} anchor={hoveredAnchor} />}
      </div>
      {hoverMode && <HoverProtoLayer debug={hoverDebug} payload={hoverPayload} />}
      {pickerOpen && (
        <SourcePicker
          onClose={() => setPickerOpen(false)}
          onConfirmed={handlePickerConfirmed}
        />
      )}
    </>
  )
}

function pipColor(status: SourceStatus, active: SharedWindowSource | null): string {
  if (!active) return 'bg-white/30'
  if (status === 'connected') return 'bg-emerald-400'
  if (status === 'reconnecting') return 'bg-amber-400'
  return 'bg-white/30'
}

function statusLabel(status: SourceStatus, active: SharedWindowSource | null): string {
  if (!active) return 'no source'
  return status
}

export default App
