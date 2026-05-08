import { useCallback, useEffect, useRef, useState } from 'react'
import { attachClickThrough } from './lib/clickthrough'
import { TokenLine } from './components/TokenLine'
import { SourcePicker } from './components/SourcePicker'
import type { CaptureHandle } from './lib/capture'
import type {
  SharedWindowSource,
  SharedWordGroup,
  SourceStatus
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeSource, setActiveSource] = useState<SharedWindowSource | null>(null)
  const captureRef = useRef<CaptureHandle | null>(null)
  const lookupTokenRef = useRef(0)

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

  // Tear down capture on unmount.
  useEffect(() => {
    return () => {
      if (captureRef.current) {
        captureRef.current.stop()
        captureRef.current = null
      }
    }
  }, [])

  const onHover = useCallback(
    async (group: SharedWordGroup, target: HTMLElement): Promise<void> => {
      const token = ++lookupTokenRef.current
      try {
        const result = await window.vnr.lookupGroup(group)
        if (token !== lookupTokenRef.current) return
        if (result.entries.length === 0) return
        const rect = target.getBoundingClientRect()
        window.vnr.popupShow({
          screenX: window.screenX + rect.left,
          screenY: window.screenY + rect.top,
          anchorTop: window.screenY + rect.top,
          anchorBottom: window.screenY + rect.bottom,
          data: result
        })
      } catch (err) {
        console.error('[overlay] lookup/show failed:', err)
      }
    },
    []
  )

  const onLeave = useCallback((): void => {
    lookupTokenRef.current += 1
    window.vnr.popupHide()
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
      <div className="flex h-full w-full flex-col items-center justify-end p-3">
        <div className="hit flex w-full max-w-[92%] flex-col gap-1 rounded-xl border border-white/5 bg-black/75 px-6 py-3 shadow-2xl backdrop-blur">
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
