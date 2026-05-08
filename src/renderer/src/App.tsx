import { useCallback, useEffect, useRef, useState } from 'react'
import { attachClickThrough } from './lib/clickthrough'
import { TokenLine } from './components/TokenLine'
import { Popup } from './components/Popup'
import { SourcePicker } from './components/SourcePicker'
import type { CaptureHandle } from './lib/capture'
import type {
  SharedLookupResult,
  SharedWindowSource,
  SharedWordGroup,
  SourceStatus
} from '@shared/ipc'

interface RenderedLine {
  id: number
  text: string
  groups: SharedWordGroup[]
}

// Just the current line — scrollback is a Ship 4 polish item with its
// own UI (older lines dimmed, click to re-show, etc.).
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
  const captureRef = useRef<CaptureHandle | null>(null)

  useEffect(() => attachClickThrough(), [])

  useEffect(
    () =>
      window.vnr.onLine(async (text) => {
        console.log('[overlay] text:line received:', text)
        try {
          const groups = await window.vnr.tokenize(text)
          console.log('[overlay] tokenized', groups.length, 'groups')
          setLines((prev) => [
            ...prev.slice(-(HISTORY_LIMIT - 1)),
            { id: nextLineId++, text, groups }
          ])
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

  // Tear down capture on unmount.
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
        <div className="hit flex max-w-[92%] flex-col gap-2 rounded-xl border border-white/5 bg-black/75 px-6 py-4 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-white/40">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${pipColor(status, activeSource)}`}
              />
              <span>{statusLabel(status, activeSource)}</span>
            </div>
            <button
              type="button"
              onClick={handleOpenPicker}
              className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] tracking-widest text-white/70 hover:bg-white/10"
            >
              {activeSource ? 'change source' : 'select source'}
            </button>
          </div>
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
        {lookup && hoveredAnchor && <Popup data={lookup} anchor={hoveredAnchor} />}
      </div>
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
