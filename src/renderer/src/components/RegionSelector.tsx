import { useCallback, useEffect, useRef, useState } from 'react'
import type { SharedRegion } from '@shared/ipc'

interface Props {
  frame: ImageBitmap | null
  initialRegion?: SharedRegion | null
  onConfirm: (region: SharedRegion) => void
  onCancel: () => void
}

interface DragState {
  startX: number
  startY: number
  endX: number
  endY: number
}

// Renders the latest captured frame onto a canvas, lets the user drag a
// rectangle over the textbox, and emits the region in source-window pixel
// coordinates (NOT canvas-display coordinates — accounts for the
// canvas-to-bitmap scale ratio).
export function RegionSelector({ frame, initialRegion, onConfirm, onCancel }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [region, setRegion] = useState<SharedRegion | null>(initialRegion ?? null)

  // Redraw whenever a new frame arrives, with overlay shading + region outline.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    canvas.width = frame.width
    canvas.height = frame.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(frame, 0, 0)

    const active = drag
      ? normalize(drag, frame.width, frame.height)
      : region
    if (active) {
      // Dim everything except the active rectangle.
      ctx.save()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(0, 0, frame.width, active.y)
      ctx.fillRect(0, active.y, active.x, active.h)
      ctx.fillRect(active.x + active.w, active.y, frame.width - (active.x + active.w), active.h)
      ctx.fillRect(0, active.y + active.h, frame.width, frame.height - (active.y + active.h))
      ctx.restore()

      // Canvas can't consume CSS vars — resolve the accent token at draw time.
      ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-accent-rose')
        .trim()
      ctx.lineWidth = Math.max(2, frame.width / 600)
      ctx.strokeRect(active.x, active.y, active.w, active.h)
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.fillRect(0, 0, frame.width, frame.height)
    }
  }, [frame, drag, region])

  const toFrameCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
      const canvas = canvasRef.current
      if (!canvas || !frame) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const scaleX = frame.width / rect.width
      const scaleY = frame.height / rect.height
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
      }
    },
    [frame]
  )

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const { x, y } = toFrameCoords(e)
    setDrag({ startX: x, startY: y, endX: x, endY: y })
    setRegion(null)
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!drag) return
    const { x, y } = toFrameCoords(e)
    setDrag({ ...drag, endX: x, endY: y })
  }

  const onMouseUp = (): void => {
    if (!drag || !frame) return
    const r = normalize(drag, frame.width, frame.height)
    if (r.w >= 8 && r.h >= 8) {
      setRegion(r)
    }
    setDrag(null)
  }

  const handleConfirm = (): void => {
    if (region) onConfirm(region)
  }

  return (
    <div className="hit flex flex-col gap-3">
      <div className="text-sm text-text-secondary">
        Drag a rectangle over the dialogue area, then click confirm.
      </div>
      <div className="shadow-[inset_0_0_0_1px_var(--color-surface-edge)]">
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          className="block max-h-[60vh] w-full cursor-crosshair select-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="vnr-btn vnr-btn--md" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="vnr-btn vnr-btn--md vnr-btn--primary font-medium"
          disabled={!region}
          onClick={handleConfirm}
        >
          Confirm region
        </button>
      </div>
    </div>
  )
}

function normalize(d: DragState, maxW: number, maxH: number): SharedRegion {
  const x = Math.max(0, Math.min(d.startX, d.endX))
  const y = Math.max(0, Math.min(d.startY, d.endY))
  const w = Math.min(maxW - x, Math.abs(d.endX - d.startX))
  const h = Math.min(maxH - y, Math.abs(d.endY - d.startY))
  return { x, y, w, h }
}
