import { useLayoutEffect, useRef, useState } from 'react'
import type { SharedLookupResult, SharedJmdictEntry } from '@shared/ipc'

interface Props {
  /** Lookup result. Null means "still loading" — render the popup chrome
   *  with a shimmer so the user gets immediate visual feedback that hover
   *  was registered, even though the dictionary entry depends on the VLM
   *  transcription that's still in flight. */
  data: SharedLookupResult | null
  anchor: HTMLElement
}

interface Position {
  left: number
  top: number
}

const MAX_ENTRIES = 3
const MAX_SENSES = 3

function readingsLine(entry: SharedJmdictEntry): string {
  return entry.kana.map((k) => k.text).join('・')
}

function headlineForm(entry: SharedJmdictEntry): string {
  return entry.kanji[0]?.text ?? entry.kana[0]?.text ?? '?'
}

export function Popup({ data, anchor }: Props): React.JSX.Element | null {
  const popupRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Position | null>(null)

  useLayoutEffect(() => {
    if (!popupRef.current) return
    const rect = anchor.getBoundingClientRect()
    const popupRect = popupRef.current.getBoundingClientRect()
    const margin = 8

    let left = rect.left
    let top = rect.top - popupRect.height - margin

    // Clamp horizontally to viewport
    if (left + popupRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popupRect.width - margin
    }
    if (left < margin) left = margin

    // If not enough room above, flip below the anchor
    if (top < margin) {
      top = rect.bottom + margin
    }

    setPos({ left, top })
  }, [anchor, data])

  if (data && data.entries.length === 0) return null

  return (
    <div
      ref={popupRef}
      className="pointer-events-none absolute z-50 min-w-[18rem] max-w-md rounded-lg border border-white/10 bg-black/95 p-4 shadow-2xl backdrop-blur-md"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        opacity: pos ? 1 : 0
      }}
    >
      {data === null ? (
        <div className="space-y-2">
          <div className="vnr-shimmer h-7 w-24 rounded-md" />
          <div className="vnr-shimmer h-4 w-56 rounded-md" />
          <div className="vnr-shimmer mt-3 h-4 w-64 rounded-md" />
          <div className="vnr-shimmer h-4 w-48 rounded-md" />
        </div>
      ) : (
        data.entries.slice(0, MAX_ENTRIES).map((entry, i) => (
        <div key={entry.id} className={i > 0 ? 'mt-3 border-t border-white/10 pt-3' : ''}>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-medium text-white">{headlineForm(entry)}</span>
            {entry.kanji.length > 0 && entry.kana.length > 0 && (
              <span className="text-base text-white/60">{readingsLine(entry)}</span>
            )}
          </div>
          {i === 0 && data.chain.length > 0 && (
            <div className="mt-1 text-xs text-amber-300/80">
              {data.chain.map((s) => s.description).join(' › ')}
            </div>
          )}
          <div className="mt-2 space-y-1.5">
            {entry.senses.slice(0, MAX_SENSES).map((sense, si) => (
              <div key={si} className="text-sm leading-snug">
                <span className="mr-1 text-white/40">{si + 1}.</span>
                {sense.partOfSpeech.length > 0 && (
                  <span className="mr-1.5 text-xs text-cyan-300/70">
                    [{sense.partOfSpeech.slice(0, 2).join(', ')}]
                  </span>
                )}
                <span className="text-white/90">
                  {sense.gloss.map((g) => g.text).join('; ')}
                </span>
              </div>
            ))}
          </div>
        </div>
        ))
      )}
    </div>
  )
}
