import { hammingDistance } from './hamming'

// State machine that decides when an incoming frame is "settled enough"
// to OCR. The hash stream comes in at ~5fps from the renderer.
//
// Algorithm:
//   - First frame seeds state.
//   - If the new hash is meaningfully different from the previous one
//     (Hamming > changeThreshold), record `unstableSince = now` and wait.
//   - If the new hash is similar to the previous one AND we've been
//     past `unstableSince + stabilizationMs`, fire OCR and clear the
//     unstableSince marker so we don't fire again until the next change.
//   - Hard interval lock: if we'd fire on a hash within changeThreshold
//     of the previously-fired hash AND it's been < hardIntervalMs since
//     that fire, suppress.
//
// Defaults from R-OCR research: changeThreshold=5, stabilizationMs=350,
// hardIntervalMs=800.

export interface StabilizerConfig {
  changeThreshold: number
  stabilizationMs: number
  hardIntervalMs: number
}

export const DEFAULT_STABILIZER_CONFIG: StabilizerConfig = {
  changeThreshold: 5,
  stabilizationMs: 350,
  hardIntervalMs: 800
}

export type StabilizerEvent =
  | { type: 'fire'; hash: string }
  | { type: 'skip'; reason: 'first' | 'unstable' | 'settled-already' | 'rate-limited' }

export class Stabilizer {
  private prevHash: string | null = null
  private unstableSince: number | null = null
  private lastFiredAt = 0
  private lastFiredHash: string | null = null

  constructor(private readonly cfg: StabilizerConfig = DEFAULT_STABILIZER_CONFIG) {}

  observe(hash: string, now: number = Date.now()): StabilizerEvent {
    if (this.prevHash === null) {
      this.prevHash = hash
      this.unstableSince = now
      return { type: 'skip', reason: 'first' }
    }

    const distFromPrev = hammingDistance(hash, this.prevHash)

    if (distFromPrev > this.cfg.changeThreshold) {
      this.unstableSince = now
      this.prevHash = hash
      return { type: 'skip', reason: 'unstable' }
    }

    this.prevHash = hash

    if (this.unstableSince === null) {
      // Already fired for this stable window; wait for next change.
      return { type: 'skip', reason: 'settled-already' }
    }

    if (now - this.unstableSince < this.cfg.stabilizationMs) {
      return { type: 'skip', reason: 'unstable' }
    }

    // Hard interval lock.
    if (
      this.lastFiredHash !== null &&
      hammingDistance(hash, this.lastFiredHash) <= this.cfg.changeThreshold &&
      now - this.lastFiredAt < this.cfg.hardIntervalMs
    ) {
      this.unstableSince = null
      return { type: 'skip', reason: 'rate-limited' }
    }

    this.lastFiredAt = now
    this.lastFiredHash = hash
    this.unstableSince = null
    return { type: 'fire', hash }
  }

  reset(): void {
    this.prevHash = null
    this.unstableSince = null
    this.lastFiredAt = 0
    this.lastFiredHash = null
  }
}
