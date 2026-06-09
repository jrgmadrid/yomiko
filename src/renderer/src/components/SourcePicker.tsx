import { useEffect, useRef, useState } from 'react'
import type { SharedRegion, SharedWindowSource } from '@shared/ipc'
import { startCapture, type CaptureHandle } from '../lib/capture'
import { Pulse } from './Pulse'
import { RegionSelector } from './RegionSelector'

interface Props {
  onClose: () => void
  onConfirmed: (
    source: SharedWindowSource,
    region: SharedRegion,
    handle: CaptureHandle
  ) => void
}

type Step = 'list' | 'region'

export function SourcePicker({ onClose, onConfirmed }: Props): React.JSX.Element {
  const [windows, setWindows] = useState<SharedWindowSource[]>([])
  const [step, setStep] = useState<Step>('list')
  const [selected, setSelected] = useState<SharedWindowSource | null>(null)
  const [frame, setFrame] = useState<ImageBitmap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<CaptureHandle | null>(null)
  const releasedRef = useRef(false)

  useEffect(() => {
    window.vnr.listWindows().then(setWindows).catch((err) => {
      setError(`couldn't list windows: ${(err as Error).message}`)
    })
  }, [])

  // Tear down the capture on unmount UNLESS the picker handed it off via
  // onConfirmed (released = true).
  useEffect(() => {
    return () => {
      if (!releasedRef.current && handleRef.current) {
        handleRef.current.stop()
        handleRef.current = null
      }
    }
  }, [])

  const handlePickWindow = async (source: SharedWindowSource): Promise<void> => {
    setSelected(source)
    setError(null)
    try {
      window.vnr.setSource(source.id)
      // tiny delay so main has the source ID staged before getDisplayMedia fires
      await new Promise((resolve) => setTimeout(resolve, 50))
      const handle = await startCapture()
      handleRef.current = handle

      // Whole-window capture: wait for the first frame to learn the captured
      // stream's pixel dimensions, then auto-confirm a full-frame region. The
      // hover-zone path filters non-Japanese OCR detections (chrome, buttons,
      // English UI) so margins don't matter the way they did when we were
      // emitting parsed text into a pill bar. RegionSelector stays in the file
      // as a future "atypical layouts" escape hatch.
      handle.onFullFrame(async (bitmap) => {
        if (releasedRef.current) return
        handle.onFullFrame(null)
        const region: SharedRegion = { x: 0, y: 0, w: bitmap.width, h: bitmap.height }
        handle.setRegion(region)
        await window.vnr.setRegion(source.name, region)
        releasedRef.current = true
        onConfirmed(source, region, handle)
      })
    } catch (err) {
      setError(`capture failed: ${(err as Error).message}`)
    }
  }

  const handleConfirmRegion = async (region: SharedRegion): Promise<void> => {
    if (!selected || !handleRef.current) return
    handleRef.current.onFullFrame(null)
    handleRef.current.setRegion(region)
    await window.vnr.setRegion(selected.name, region)
    releasedRef.current = true
    onConfirmed(selected, region, handleRef.current)
  }

  const handleBack = (): void => {
    if (handleRef.current) {
      handleRef.current.stop()
      handleRef.current = null
    }
    setSelected(null)
    setFrame(null)
    setStep('list')
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/55 p-8">
      <div className="vnr-panel hit flex max-h-[calc(100vh-4rem)] max-w-3xl flex-col overflow-hidden p-5 text-text-primary">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <h2 className="text-base font-medium tracking-wide text-accent-rose">
            {step === 'list' ? 'Select VN window' : `${selected?.name}`}
          </h2>
          <div className="flex gap-2">
            {step === 'region' && (
              <button type="button" className="vnr-btn vnr-btn--md" onClick={handleBack}>
                ← Back
              </button>
            )}
            <button type="button" className="vnr-btn vnr-btn--md" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>

        {error && <div className="vnr-alert mb-3 shrink-0 px-3 py-2 text-sm">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 'list' &&
            (windows.length === 0 ? (
              <div className="flex flex-col gap-2 py-2">
                <div className="flex items-center gap-2 text-sm text-text-primary">
                  <Pulse label="Loading windows" />
                  <span>Looking for windows</span>
                </div>
                <div className="text-xs leading-relaxed text-text-tertiary">
                  First run? macOS will ask for Screen Recording access.
                  Allow it, close this dialog, then open it again.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 pr-1">
                {windows.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handlePickWindow(w)}
                    className="vnr-tile flex flex-col gap-2 p-2 text-left"
                  >
                    <img
                      src={w.thumbnailDataUrl}
                      alt={w.name}
                      className="aspect-video w-full bg-surface-base object-contain"
                    />
                    <div className="line-clamp-2 text-xs text-text-primary">{w.name}</div>
                  </button>
                ))}
              </div>
            ))}

          {step === 'region' && (
            <RegionSelector
              frame={frame}
              initialRegion={null}
              onConfirm={handleConfirmRegion}
              onCancel={handleBack}
            />
          )}
        </div>
      </div>
    </div>
  )
}
