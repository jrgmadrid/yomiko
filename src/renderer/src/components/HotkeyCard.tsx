import { useEffect, useReducer, type RefObject } from 'react'

// Compact reference card surfacing the global + in-zone hotkeys. Anchored
// to the status strip's `?` button via a passed ref + fixed positioning so
// it escapes the strip's `overflow-hidden` container. Persistent until the
// `?` is toggled again; no click-outside-to-dismiss because a `.hit`
// backdrop would break click-through to the captured game window beneath.

const IS_MAC = navigator.platform.toLowerCase().includes('mac')

function chord(letter: string): string {
  return IS_MAC ? `⌘⇧${letter}` : `Ctrl+Shift+${letter}`
}

function shift(suffix: string): string {
  return IS_MAC ? `⇧+${suffix}` : `Shift+${suffix}`
}

const ROWS = [
  { key: chord('M'), label: 'Save sentence to Anki' },
  { key: chord('T'), label: 'Translate full screen' },
  { key: chord('H'), label: 'Toggle hover overlay' },
  { key: chord('D'), label: 'Show hover zones (debug)' },
  { key: shift('hover'), label: 'Open dictionary on a word' }
] as const

interface Props {
  /** Button the card anchors to. The ref form (not the unwrapped element)
   *  lets the parent render this without a `&& ref.current` guard: this
   *  component handles the null case itself. */
  anchor: RefObject<HTMLElement | null>
}

export function HotkeyCard({ anchor }: Props): React.JSX.Element | null {
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener('resize', forceRender)
    return () => window.removeEventListener('resize', forceRender)
  }, [])

  const el = anchor.current
  if (!el) return null

  const r = el.getBoundingClientRect()
  // Right-align card's right edge with the button's; sit 8px above the top.
  const right = Math.max(8, window.innerWidth - r.right)
  const bottom = Math.max(8, window.innerHeight - r.top + 8)

  return (
    <div
      className="vnr-panel hit fixed z-[var(--z-popover)] px-4 py-3"
      style={{ right, bottom, color: 'var(--text-primary)', minWidth: '18rem' }}
    >
      <div
        className="mb-2 text-[10px] tracking-[0.2em] uppercase"
        style={{ color: 'var(--accent-rose)' }}
      >
        Shortcuts
      </div>
      <div className="flex flex-col gap-1.5 text-[12px]">
        {ROWS.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-6">
            <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
            <span className="tracking-wide tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {r.key}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
