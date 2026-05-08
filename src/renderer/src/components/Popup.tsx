import type { SharedLookupResult, SharedJmdictEntry } from '@shared/ipc'

interface Props {
  data: SharedLookupResult
}

const MAX_ENTRIES = 3
const MAX_SENSES = 3

function readingsLine(entry: SharedJmdictEntry): string {
  return entry.kana.map((k) => k.text).join('・')
}

function headlineForm(entry: SharedJmdictEntry): string {
  return entry.kanji[0]?.text ?? entry.kana[0]?.text ?? '?'
}

// Renders the popup body. Used inside the dedicated popup BrowserWindow
// (positioned by main relative to the hovered token's screen rect), so this
// component is positioning-agnostic — it just fills its container.
export function Popup({ data }: Props): React.JSX.Element | null {
  if (data.entries.length === 0) return null

  const entries = data.entries.slice(0, MAX_ENTRIES)

  return (
    <div className="pointer-events-none m-2 rounded-lg border border-white/10 bg-black/95 p-4 shadow-2xl backdrop-blur-md">
      {entries.map((entry, i) => (
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
      ))}
    </div>
  )
}
