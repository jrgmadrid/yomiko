// Hamming distance between two equal-length hex-string hashes.
// Works for any byte-aligned length (so we can swap dHash size without
// touching the stabilizer). Returns total bit-popcount of XOR.

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0 || a.length % 8 !== 0) {
    return Number.MAX_SAFE_INTEGER
  }
  let total = 0
  for (let i = 0; i < a.length; i += 8) {
    const av = parseInt(a.slice(i, i + 8), 16)
    const bv = parseInt(b.slice(i, i + 8), 16)
    total += popcount32(av ^ bv)
  }
  return total
}

function popcount32(n: number): number {
  let v = n >>> 0
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  v = (v + (v >>> 4)) & 0x0f0f0f0f
  return (v * 0x01010101) >>> 24
}
