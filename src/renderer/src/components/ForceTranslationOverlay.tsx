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
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-12">
      <div className="hit pointer-events-auto max-w-[640px] rounded-xl border border-white/15 bg-black/90 px-6 py-5 shadow-2xl backdrop-blur">
        {force.kind === 'start' ? (
          <div className="space-y-3">
            <div className="vnr-shimmer h-4 w-64 rounded-md" />
            <div className="vnr-shimmer h-6 w-96 rounded-md" />
          </div>
        ) : (
          <>
            <div className="text-xs tracking-wide text-white/50">{force.text}</div>
            <div className="mt-2 text-lg leading-relaxed text-white">{force.translation}</div>
          </>
        )}
        <div className="mt-4 text-[10px] uppercase tracking-widest text-white/30">
          ⌘⇧T to dismiss
        </div>
      </div>
    </div>
  )
}
