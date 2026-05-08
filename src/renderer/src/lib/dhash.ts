// 256-bit dHash for fast frame change detection.
//
// Resamples the source rectangle to 17x16 grayscale via the canvas API,
// then for each of the 16 rows, compares adjacent pixels left-to-right
// (16 comparisons per row → 16 bits per row → 256 bits total).
//
// Earlier 64-bit dHash (9x8) discriminated frames too coarsely for VN
// textbox content — different lines produced hashes within Hamming
// distance ≤ 5, so the stabilizer treated them as "the same line."
//
// Returned as a 64-char lowercase hex string for IPC transport.

const HASH_W = 17
const HASH_H = 16

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

  const gray = new Uint8Array(HASH_W * HASH_H)
  for (let i = 0; i < HASH_W * HASH_H; i += 1) {
    const r = data[i * 4] ?? 0
    const g = data[i * 4 + 1] ?? 0
    const b = data[i * 4 + 2] ?? 0
    gray[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
  }

  // 256 bits, emitted in MSB-first order.
  const bytes = new Uint8Array(32)
  let bitPos = 0
  for (let row = 0; row < HASH_H; row += 1) {
    for (let col = 0; col < HASH_W - 1; col += 1) {
      const left = gray[row * HASH_W + col] ?? 0
      const right = gray[row * HASH_W + col + 1] ?? 0
      if (left > right) {
        const byteIdx = bitPos >> 3
        const bitOffset = 7 - (bitPos & 7)
        bytes[byteIdx] = (bytes[byteIdx] ?? 0) | (1 << bitOffset)
      }
      bitPos += 1
    }
  }

  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  }
  return hex
}
