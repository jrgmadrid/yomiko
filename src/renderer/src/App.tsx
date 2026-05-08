import { useCallback, useEffect, useState } from 'react'
import { attachClickThrough } from './lib/clickthrough'
import { TokenLine } from './components/TokenLine'
import { Popup } from './components/Popup'
import type {
  SharedLookupResult,
  SharedWordGroup,
  SourceStatus
} from '@shared/ipc'

interface RenderedLine {
  id: number
  text: string
  groups: SharedWordGroup[]
}

const HISTORY_LIMIT = 4
let nextLineId = 1

function App(): React.JSX.Element {
  const [lines, setLines] = useState<RenderedLine[]>([])
  const [status, setStatus] = useState<SourceStatus>('disconnected')
  const [hoveredGroup, setHoveredGroup] = useState<SharedWordGroup | null>(null)
  const [hoveredAnchor, setHoveredAnchor] = useState<HTMLElement | null>(null)
  const [lookup, setLookup] = useState<SharedLookupResult | null>(null)

  useEffect(() => attachClickThrough(), [])

  useEffect(
    () =>
      window.vnr.onLine(async (text) => {
        try {
          const groups = await window.vnr.tokenize(text)
          setLines((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), { id: nextLineId++, text, groups }])
        } catch (err) {
          console.error('tokenize failed:', err)
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

  const onHover = useCallback((group: SharedWordGroup, target: HTMLElement) => {
    setHoveredGroup(group)
    setHoveredAnchor(target)
  }, [])

  const onLeave = useCallback(() => {
    setHoveredGroup(null)
    setHoveredAnchor(null)
  }, [])

  return (
    <div className="flex h-full w-full flex-col items-center justify-end p-6">
      <div className="hit flex max-w-[92%] flex-col gap-1 rounded-xl border border-white/5 bg-black/75 px-6 py-4 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              status === 'connected'
                ? 'bg-emerald-400'
                : status === 'reconnecting'
                  ? 'bg-amber-400'
                  : 'bg-white/30'
            }`}
          />
          <span>{status}</span>
        </div>
        {lines.length === 0 ? (
          <div className="text-base text-white/50">yomiko · waiting for text</div>
        ) : (
          lines.map((line) => (
            <TokenLine key={line.id} groups={line.groups} onHover={onHover} onLeave={onLeave} />
          ))
        )}
      </div>
      {lookup && hoveredAnchor && <Popup data={lookup} anchor={hoveredAnchor} />}
    </div>
  )
}

export default App
