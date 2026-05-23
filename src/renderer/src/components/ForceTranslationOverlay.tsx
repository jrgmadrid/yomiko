import { useEffect, useState } from 'react'
import type { ForceTranslationEvent } from '@shared/ipc'

// Centered overlay for the Cmd+Shift+T full-frame VLM translate. Lives at
// the App level (outside HoverProtoLayer) because it shows regardless of
// hover mode — the whole point is "Vision returned nothing and there's no
// hover target." Three states: loading shimmer, content card, hidden.
// Dismissal is hotkey-only; tracking dismiss state in main keeps the
// renderer and main in sync.
export function ForceTranslationOverlay(): React.JSX.Element | null {
  const [force, setForce] = useState<Exclude<ForceTranslationEvent, { kind: 'dismiss' }> | null>(
    null
  )

  useEffect(
    () =>
      window.vnr.onForceTranslation((e) => {
        if (e.kind === 'dismiss') setForce(null)
        else setForce(e)
      }),
    []
  )

  if (!force) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[var(--z-popover)] flex items-center justify-center p-12">
      <div
        className="vnr-panel hit pointer-events-auto max-w-[640px] px-6 py-5"
        style={{ color: 'var(--text-primary)' }}
      >
        {force.kind === 'start' ? (
          <div className="flex h-16 items-center" aria-label="Translating">
            <div className="vnr-pulse">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : (
          <>
            <div className="text-xs tracking-wide" style={{ color: 'var(--text-secondary)' }}>
              {force.text}
            </div>
            <div
              className="mt-2 text-lg leading-relaxed"
              style={{ color: 'var(--text-primary)' }}
            >
              {force.translation}
            </div>
          </>
        )}
        <div className="mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          ⌘⇧T to dismiss
        </div>
      </div>
    </div>
  )
}
