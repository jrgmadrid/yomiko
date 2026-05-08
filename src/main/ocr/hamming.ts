// Hamming distance between two 64-bit dHashes encoded as 16-char hex strings.
// Returns the popcount of the XOR; max 64.

export function hammingDistance(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64
  // Compare as two 32-bit halves to avoid BigInt allocation in the hot path.
  const aHi = parseInt(a.slice(0, 8), 16)
  const aLo = parseInt(a.slice(8, 16), 16)
  const bHi = parseInt(b.slice(0, 8), 16)
  const bLo = parseInt(b.slice(8, 16), 16)
  return popcount32(aHi ^ bHi) + popcount32(aLo ^ bLo)
}

function popcount32(n: number): number {
  // Hamming-weight algorithm (https://en.wikipedia.org/wiki/Hamming_weight).
  let v = n >>> 0
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  v = (v + (v >>> 4)) & 0x0f0f0f0f
  return (v * 0x01010101) >>> 24
}
