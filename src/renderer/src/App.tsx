import { useCallback, useEffect, useRef, useState } from 'react'
import { attachClickThrough } from './lib/clickthrough'
import { TokenLine } from './components/TokenLine'
import { Popup } from './components/Popup'
import { SourcePicker } from './components/SourcePicker'
import { HoverProtoLayer } from './components/HoverProtoLayer'
import { ForceTranslationOverlay } from './components/ForceTranslationOverlay'
import { HotkeyCard } from './components/HotkeyCard'
import type { CaptureHandle } from './lib/capture'
import type {
  HoverZonePayload,
  SharedLookupResult,
  SharedWindowSource,
  SharedWordGroup,
  SourceStatus,
  VlmStatus
} from '@shared/ipc'

interface RenderedLine {
  id: number
  text: string
  groups: SharedWordGroup[]
}

const HISTORY_LIMIT = 1
let nextLineId = 1

function App(): React.JSX.Element {
  const [lines, setLines] = useState<RenderedLine[]>([])
  const [status, setStatus] = useState<SourceStatus>('disconnected')
  const [hoveredGroup, setHoveredGroup] = useState<SharedWordGroup | null>(null)
  const [hoveredAnchor, setHoveredAnchor] = useState<HTMLElement | null>(null)
  const [lookup, setLookup] = useState<SharedLookupResult | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeSource, setActiveSource] = useState<SharedWindowSource | null>(null)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const captureRef = useRef<CaptureHandle | null>(null)
  const helpButtonRef = useRef<HTMLButtonElement | null>(null)
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

  // VLM proxy status, surfaced as a pill in the status strip so the user
  // knows whether on-hover translation will work. Main owns the state and
  // pushes transitions; we ask for the current value on mount because main
  // already probed creds at startup before the renderer subscribes.
  const [vlmStatus, setVlmStatus] = useState<VlmStatus>('no-creds')
  useEffect(() => {
    void window.vnr.getVlmStatus().then(setVlmStatus)
    return window.vnr.onVlmStatus(setVlmStatus)
  }, [])

  // Whether the captured source window is the frontmost. Main owns the
  // state (sidecar poller) and pushes transitions; we pull the current
  // value on mount — same get+subscribe shape as the VLM status — so a
  // remount can't strand us on a stale default. The overlay is
  // click-through, so without this gate the cursor wandering across hover
  // zones triggers fetches even when the user is focused on another app.
  const [sourceFocused, setSourceFocused] = useState(true)
  useEffect(() => {
    void window.vnr.getSourceFocused().then(setSourceFocused)
    return window.vnr.onSourceFocusChanged(setSourceFocused)
  }, [])

  // Ask main to re-emit its cached HoverZonePayload whenever hover mode
  // turns on (including initial mount when the default is on). Backstop
  // for the static-window case: if the user toggles hover off → does
  // something else that loses App state → toggles back on, OCR's
  // stabilizer won't refire on a still-static target. Main keeps the last
  // payload latched, so resync is cheap.
  useEffect(() => {
    if (hoverMode) window.vnr.requestHoverResync()
  }, [hoverMode])

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
        <div className="vnr-strip hit flex max-h-[85vh] max-w-[92%] flex-col gap-2 overflow-hidden px-6 pt-4 pb-3">
          <div className="flex shrink-0 items-center justify-between gap-3 text-[11px] tracking-wide">
            <div className="flex items-center gap-2.5 text-text-secondary">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${pipColor(status, activeSource)}`}
              />
              <span>{statusLabel(status, activeSource)}</span>
              {activeSource && (
                <span
                  className="max-w-[220px] truncate text-text-tertiary"
                  title={activeSource.name}
                >
                  {activeSource.name}
                </span>
              )}
              {hoverMode && (
                <span className="bg-accent-rose-tint px-1.5 py-0.5 text-accent-rose">
                  hover · ⇧ dict{hoverDebug ? ' · debug' : ''}
                </span>
              )}
              <span
                className={`px-1.5 py-0.5 ${vlmPillClass(vlmStatus)}`}
                title={vlmPillTooltip(vlmStatus)}
              >
                {vlmPillLabel(vlmStatus)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                ref={helpButtonRef}
                type="button"
                className="vnr-btn"
                data-active={hotkeysOpen || undefined}
                aria-label={hotkeysOpen ? 'Hide keyboard shortcuts' : 'Show keyboard shortcuts'}
                aria-expanded={hotkeysOpen}
                onClick={() => setHotkeysOpen((v) => !v)}
              >
                ?
              </button>
              <button type="button" className="vnr-btn" onClick={handleOpenPicker}>
                {activeSource ? 'change window' : 'pick a window'}
              </button>
            </div>
          </div>
          {!hoverMode && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {lines.length === 0 ? (
                <div className="text-base text-text-secondary">
                  {activeSource
                    ? `Watching ${activeSource.name} — waiting for text`
                    : 'Click "pick a window" to start reading'}
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
        </div>
        {lookup && hoveredAnchor && <Popup data={lookup} anchor={hoveredAnchor} />}
      </div>
      {hoverMode && (
        <HoverProtoLayer
          debug={hoverDebug}
          payload={hoverPayload}
          sourceFocused={sourceFocused}
        />
      )}
      <ForceTranslationOverlay />
      {hotkeysOpen && <HotkeyCard anchor={helpButtonRef} />}
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
  if (!active) return 'bg-text-tertiary'
  if (status === 'connected') return 'bg-accent-mint'
  if (status === 'reconnecting') return 'bg-accent-amber'
  return 'bg-text-tertiary'
}

function statusLabel(status: SourceStatus, active: SharedWindowSource | null): string {
  if (!active) return 'no window'
  if (status === 'connected') return 'watching'
  if (status === 'reconnecting') return 'reconnecting…'
  return 'disconnected'
}

function vlmPillLabel(s: VlmStatus): string {
  if (s === 'ready') return 'translation ready'
  return 'translation offline ⚠'
}

function vlmPillClass(s: VlmStatus): string {
  if (s === 'ready') return 'bg-accent-mint-tint text-accent-mint'
  return 'bg-accent-amber-tint text-accent-amber'
}

function vlmPillTooltip(s: VlmStatus): string {
  if (s === 'ready') return 'VLM proxy ready'
  if (s === 'unreachable') return 'VLM proxy unreachable — last call failed (check network / proxy)'
  return 'No proxy creds — set proxyUrl/proxyToken in ~/Library/Application Support/yomiko/settings.json or YOMIKO_PROXY_URL/TOKEN env vars'
}

export default App
