// Verifies the stabilizer + deduper produce the right events for a
// synthetic frame sequence. No real capture involved.
//
// Run: npx tsx scripts/verify-diff.ts

import {
  Stabilizer,
  DEFAULT_STABILIZER_CONFIG,
  type StabilizerEvent
} from '../src/main/ocr/stabilizer'
import { Deduper } from '../src/main/ocr/dedupe'

interface Frame {
  hash: string
  text?: string
  ts: number
}

// Helper: 16-char hex hash with optional perturbation in low bits.
function h(seed: number, perturbBits = 0): string {
  // Build a base hash from seed, optionally flip low bits.
  const base = BigInt(seed) * 0x1234567812345678n
  let bits = base & 0xffffffffffffffffn
  for (let i = 0; i < perturbBits; i += 1) bits ^= 1n << BigInt(i)
  return bits.toString(16).padStart(16, '0').slice(-16)
}

// Frame timeline: static empty box, dialog rolls in over 600ms, settles for
// 1s, then a new line rolls in.
const t0 = 0
const frames: Frame[] = [
  { hash: h(0), ts: t0 + 0 },
  { hash: h(0), ts: t0 + 200 },
  { hash: h(0), ts: t0 + 400 },
  // Dialog starts rolling
  { hash: h(1), ts: t0 + 600, text: 'こんに' },
  { hash: h(1, 3), ts: t0 + 800, text: 'こんにちは' },
  { hash: h(1, 5), ts: t0 + 1000, text: 'こんにちは、' },
  { hash: h(1, 6), ts: t0 + 1200, text: 'こんにちは、世界' },
  // Settled
  { hash: h(1, 6), ts: t0 + 1400, text: 'こんにちは、世界' },
  { hash: h(1, 6), ts: t0 + 1600, text: 'こんにちは、世界' },
  { hash: h(1, 6), ts: t0 + 1800, text: 'こんにちは、世界' },
  // New line rolls in
  { hash: h(2), ts: t0 + 2200, text: 'お元' },
  { hash: h(2, 3), ts: t0 + 2400, text: 'お元気ですか' },
  { hash: h(2, 5), ts: t0 + 2600, text: 'お元気ですか？' },
  { hash: h(2, 5), ts: t0 + 2800, text: 'お元気ですか？' },
  { hash: h(2, 5), ts: t0 + 3000, text: 'お元気ですか？' }
]

function describe(ev: StabilizerEvent): string {
  return ev.type === 'fire' ? 'FIRE' : `skip(${ev.reason})`
}

const stabilizer = new Stabilizer(DEFAULT_STABILIZER_CONFIG)
const deduper = new Deduper()

console.log('hash                   ts(ms)  stabilizer       dedupe         text')
console.log('-'.repeat(80))
for (const f of frames) {
  const ev = stabilizer.observe(f.hash, f.ts)
  let dedupeOut = ''
  if (ev.type === 'fire' && f.text) {
    dedupeOut = deduper.shouldEmit(f.text) ? 'EMIT' : 'suppress'
  }
  console.log(
    `${f.hash}  ${String(f.ts).padStart(6)}  ${describe(ev).padEnd(16)}  ${dedupeOut.padEnd(12)}  ${f.text ?? ''}`
  )
}
