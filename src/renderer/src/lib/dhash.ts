// 256-bit average-hash (aHash) for frame change detection.
//
// Resamples the source rectangle to 16x16 grayscale, computes the mean
// luminance, and emits one bit per cell (above mean = 1, below = 0).
//
// Why aHash instead of the more commonly cited dHash:
//   The earlier dHash compared *adjacent* pixels per row. For a VN
//   textbox (dark background, sparse light text) most adjacent pairs
//   are background-equal — bit 0 for both. Different lines produced
//   Hamming deltas of ≤ 7 bits, which is below any sane stabilization
//   threshold. aHash buckets each cell against the global mean,
//   yielding a bit-mask of "where the bright pixels are" — text glyph
//   positions dominate. Distinct lines produce deltas of 30-80 bits.
//
// Returned as a 64-char lowercase hex string for IPC transport.

const HASH_W = 16
const HASH_H = 16
const N = HASH_W * HASH_H

let scratch: HTMLCanvasElement | null = null

function getScratch(): HTMLCanvasElement {
  if (!scratch) {
    scratch = document.createElement('canvas')
    scratch.width = HASH_W
    scratch.height = HASH_H
  }
  return scratch
}

export function dHashHex(
  src: HTMLCanvasElement | ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): string {
  const c = getScratch()
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return '0'.repeat(64)
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, HASH_W, HASH_H)
  const { data } = ctx.getImageData(0, 0, HASH_W, HASH_H)

  const gray = new Uint8Array(N)
  let sum = 0
  for (let i = 0; i < N; i += 1) {
    const r = data[i * 4] ?? 0
    const g = data[i * 4 + 1] ?? 0
    const b = data[i * 4 + 2] ?? 0
    const v = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
    gray[i] = v
    sum += v
  }
  const mean = sum / N

  // 256 bits, one per cell, MSB-first.
  const bytes = new Uint8Array(32)
  for (let i = 0; i < N; i += 1) {
    if ((gray[i] ?? 0) > mean) {
      const byteIdx = i >> 3
      const bitOffset = 7 - (i & 7)
      bytes[byteIdx] = (bytes[byteIdx] ?? 0) | (1 << bitOffset)
    }
  }

  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  }
  return hex
}
