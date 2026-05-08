// Renderer-side capture pipeline.
//
// Once main has the user's chosen source ID staged via `capture:set-source`,
// the renderer calls `getDisplayMedia` — main's request handler resolves the
// source, the stream comes back with the VN window's pixels.
//
// We attach to a hidden <video>, draw frames to a canvas at 5fps, optionally
// crop to a region, and forward each crop to main as a PNG ArrayBuffer for
// hashing + OCR.
//
// In region-selection mode, callers register `onFullFrame` to get the
// uncropped ImageBitmap each tick (renders into the region selector preview).

import type { SharedRegion } from '@shared/ipc'
import { dHashHex } from './dhash'

export interface CaptureHandle {
  stop(): void
  setRegion(region: SharedRegion | null): void
  onFullFrame(cb: ((bitmap: ImageBitmap) => void) | null): void
}

const FRAME_INTERVAL_MS = 200 // 5fps

export async function startCapture(): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 } as MediaTrackConstraints,
    audio: false
  })

  const track = stream.getVideoTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('no video track on captured stream')
  }

  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  Object.assign(video.style, {
    position: 'absolute',
    opacity: '0',
    pointerEvents: 'none',
    width: '1px',
    height: '1px',
    left: '-9999px'
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(video)
  await video.play()

  const canvas = document.createElement('canvas')
  const rawCtx = canvas.getContext('2d', { willReadFrequently: false })
  if (!rawCtx) throw new Error('canvas 2d context unavailable')
  const ctx: CanvasRenderingContext2D = rawCtx

  let region: SharedRegion | null = null
  let onFullFrameCb: ((bitmap: ImageBitmap) => void) | null = null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let frameCount = 0

  async function tick(): Promise<void> {
    if (stopped) return
    if (video.readyState >= 2 && video.videoWidth > 0) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      frameCount += 1
      if (frameCount % 25 === 0) {
        console.log(
          `[capture] tick ${frameCount}: video.currentTime=${video.currentTime.toFixed(3)} ` +
            `paused=${video.paused} readyState=${video.readyState} ` +
            `size=${video.videoWidth}x${video.videoHeight}`
        )
      }

      if (onFullFrameCb) {
        try {
          const bitmap = await createImageBitmap(canvas)
          onFullFrameCb(bitmap)
        } catch {
          // Frame skipped — nothing else listening, no need to escalate.
        }
      }

      if (region && region.w > 0 && region.h > 0) {
        const cropCanvas = document.createElement('canvas')
        cropCanvas.width = region.w
        cropCanvas.height = region.h
        const cropCtx = cropCanvas.getContext('2d')
        if (cropCtx) {
          cropCtx.drawImage(
            canvas,
            region.x,
            region.y,
            region.w,
            region.h,
            0,
            0,
            region.w,
            region.h
          )
          const hash = dHashHex(canvas, region.x, region.y, region.w, region.h)
          const blob = await new Promise<Blob | null>((resolve) =>
            cropCanvas.toBlob((b) => resolve(b), 'image/png')
          )
          if (blob) {
            const buf = await blob.arrayBuffer()
            window.vnr.captureFrame({ data: buf, region, ts: Date.now(), hash })
          }
        }
      }
    }
    timer = setTimeout(tick, FRAME_INTERVAL_MS)
  }

  void tick()

  return {
    stop(): void {
      stopped = true
      if (timer) clearTimeout(timer)
      track.stop()
      stream.getTracks().forEach((t) => t.stop())
      video.remove()
    },
    setRegion(r) {
      region = r
    },
    onFullFrame(cb) {
      onFullFrameCb = cb
    }
  }
}
