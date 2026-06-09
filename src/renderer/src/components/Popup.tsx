import { useLayoutEffect, useRef, useState } from 'react'
import type { SharedLookupResult, SharedJmdictEntry } from '@shared/ipc'
import { Pulse } from './Pulse'

interface Props {
  /** Lookup result. Null means "still loading" — render the popup chrome
   *  with the pulse affordance so the user gets immediate visual feedback
   *  that hover was registered, even though the dictionary entry depends
   *  on the VLM transcription that's still in flight. */
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
      className="vnr-panel pointer-events-none absolute z-[var(--z-popover)] min-w-[18rem] max-w-md p-4 text-text-primary"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        opacity: pos ? 1 : 0
      }}
    >
      {data === null ? (
        <div className="flex h-16 items-center">
          <Pulse label="Looking up" />
        </div>
      ) : (
        data.entries.slice(0, MAX_ENTRIES).map((entry, i) => (
        <div key={entry.id} className={i > 0 ? 'mt-3 border-t border-surface-edge pt-3' : ''}>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-medium text-accent-rose">{headlineForm(entry)}</span>
            {entry.kanji.length > 0 && entry.kana.length > 0 && (
              <span className="text-base text-text-secondary">{readingsLine(entry)}</span>
            )}
          </div>
          {i === 0 && data.chain.length > 0 && (
            <div className="mt-1 text-xs text-accent-lavender">
              {data.chain.map((s) => s.description).join(' › ')}
            </div>
          )}
          <div className="mt-2 space-y-1.5">
            {entry.senses.slice(0, MAX_SENSES).map((sense, si) => (
              <div key={si} className="text-sm leading-snug">
                <span className="mr-1 text-text-tertiary">{si + 1}.</span>
                {sense.partOfSpeech.length > 0 && (
                  <span className="mr-1.5 text-xs text-accent-lavender">
                    [{sense.partOfSpeech.slice(0, 2).join(', ')}]
                  </span>
                )}
                <span className="text-text-primary">
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
