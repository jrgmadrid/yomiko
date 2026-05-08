import { useEffect, useRef, useState } from 'react'
import type { SharedRegion, SharedWindowSource } from '@shared/ipc'
import { startCapture, type CaptureHandle } from '../lib/capture'
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
    setStep('region')
    setError(null)
    try {
      window.vnr.setSource(source.id)
      // tiny delay so main has the source ID staged before getDisplayMedia fires
      await new Promise((resolve) => setTimeout(resolve, 50))
      const handle = await startCapture()
      handleRef.current = handle
      handle.onFullFrame((bitmap) => setFrame(bitmap))
      // Restore prior region if we have one
      const prior = await window.vnr.getRegion(source.name)
      if (prior) {
        // Don't auto-confirm; show it as initial selection in RegionSelector.
        // (RegionSelector reads initialRegion prop to highlight on first paint.)
      }
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-8">
      <div className="hit flex max-h-[calc(100vh-4rem)] max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-black/95 p-5 shadow-2xl backdrop-blur">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <h2 className="text-base font-medium tracking-wide text-white">
            {step === 'list' ? 'Select VN window' : `${selected?.name}`}
          </h2>
          <div className="flex gap-2">
            {step === 'region' && (
              <button
                type="button"
                onClick={handleBack}
                className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5"
              >
                ← Back
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-3 shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 'list' &&
            (windows.length === 0 ? (
              <div className="text-sm text-white/60">
                Looking for windows… (macOS will prompt for Screen Recording
                access on first run; allow it and click Cancel + Select again.)
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 pr-1">
                {windows.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handlePickWindow(w)}
                    className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-2 text-left hover:bg-white/10"
                  >
                    <img
                      src={w.thumbnailDataUrl}
                      alt={w.name}
                      className="aspect-video w-full rounded-md bg-black object-contain"
                    />
                    <div className="line-clamp-2 text-xs text-white/80">{w.name}</div>
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
