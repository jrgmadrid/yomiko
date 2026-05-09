import { useEffect, useRef, useState } from 'react'
import type { HoverZone, HoverZonePayload, SharedLookupResult } from '@shared/ipc'
import { Popup } from './Popup'

interface Props {
  /** Render visible per-character + per-token rectangles for alignment eyeballing. */
  debug?: boolean
}

interface HoveredState {
  zone: HoverZone
  el: HTMLElement
}

export function HoverProtoLayer({ debug = false }: Props): React.JSX.Element | null {
  const [payload, setPayload] = useState<HoverZonePayload | null>(null)
  const [hovered, setHovered] = useState<HoveredState | null>(null)
  const [lookup, setLookup] = useState<SharedLookupResult | null>(null)
  const hoveredIdRef = useRef<number | null>(null)

  useEffect(() => window.vnr.onHoverZones(setPayload), [])

  useEffect(() => {
    if (!hovered) return
    hoveredIdRef.current = hovered.zone.id
    let cancelled = false
    window.vnr.lookupGroup(hovered.zone.group).then((r) => {
      if (!cancelled) setLookup(r)
    })
    return () => {
      cancelled = true
    }
  }, [hovered?.zone.id])

  if (!payload) return null

  return (
    <div className="pointer-events-none fixed inset-0">
      {debug &&
        payload.debugChars.map((c, i) => (
          <div
            key={`c${i}`}
            className="absolute border border-red-400/70 bg-red-400/10"
            style={{
              left: c.rect.x,
              top: c.rect.y,
              width: c.rect.w,
              height: c.rect.h
            }}
          />
        ))}
      {payload.zones.map((z) => (
        <div
          key={z.id}
          className={`hit pointer-events-auto absolute ${
            debug ? 'border-2 border-emerald-400/80 bg-emerald-400/10' : ''
          }`}
          style={{
            left: z.rect.x,
            top: z.rect.y,
            width: z.rect.w,
            height: z.rect.h,
            cursor: 'help'
          }}
          onMouseEnter={(e) => setHovered({ zone: z, el: e.currentTarget })}
          onMouseLeave={() => {
            setHovered(null)
            setLookup(null)
          }}
        />
      ))}
      {lookup && hovered && <Popup data={lookup} anchor={hovered.el} />}
    </div>
  )
}
