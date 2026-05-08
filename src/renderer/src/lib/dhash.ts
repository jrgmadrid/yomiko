// 64-bit dHash for fast frame change detection.
//
// Resamples the source rectangle to 9x8 grayscale via the canvas API,
// then for each of the 8 rows, compares adjacent pixels left-to-right
// (8 comparisons per row → 8 bits per row → 64 bits total).
//
// Returned as a 16-char lowercase hex string for IPC transport (BigInt
// over IPC is iffy across Electron versions).

const HASH_W = 9
const HASH_H = 8

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
  if (!ctx) return '0'.repeat(16)
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, HASH_W, HASH_H)
  const { data } = ctx.getImageData(0, 0, HASH_W, HASH_H)

  const gray = new Uint8Array(HASH_W * HASH_H)
  for (let i = 0; i < HASH_W * HASH_H; i += 1) {
    const r = data[i * 4] ?? 0
    const g = data[i * 4 + 1] ?? 0
    const b = data[i * 4 + 2] ?? 0
    gray[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
  }

  let bits = 0n
  let bit = 63n
  for (let row = 0; row < HASH_H; row += 1) {
    for (let col = 0; col < HASH_W - 1; col += 1) {
      const left = gray[row * HASH_W + col] ?? 0
      const right = gray[row * HASH_W + col + 1] ?? 0
      if (left > right) bits |= 1n << bit
      bit -= 1n
    }
  }
  return bits.toString(16).padStart(16, '0')
}
