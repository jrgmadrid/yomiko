// Post-OCR text dedupe.
//
// VN textboxes typically reveal text gradually (typewriter effect), so the
// stabilizer fires multiple times for what is, semantically, a single line.
// Each successive emission strictly contains the previous (mostly). We mirror
// OwOcr's approach: keep a small history, normalize (small kana → large), and
// suppress the new line if it's a substring of (or a superstring of) anything
// in history above a minimum overlap length.

const HISTORY_SIZE = 3
const MIN_OVERLAP = 3

// Small kana that should fold to their large counterparts during dedupe so
// "ちょっと" and "ちよつと" don't read as different lines.
const SMALL_TO_LARGE: ReadonlyMap<number, number> = new Map([
  // Hiragana
  [0x3041, 0x3042], // ぁ→あ
  [0x3043, 0x3044], // ぃ→い
  [0x3045, 0x3046], // ぅ→う
  [0x3047, 0x3048], // ぇ→え
  [0x3049, 0x304a], // ぉ→お
  [0x3063, 0x3064], // っ→つ
  [0x3083, 0x3084], // ゃ→や
  [0x3085, 0x3086], // ゅ→ゆ
  [0x3087, 0x3088], // ょ→よ
  [0x308e, 0x308f], // ゎ→わ
  [0x3095, 0x304b], // ゕ→か
  [0x3096, 0x3051], // ゖ→け
  // Katakana
  [0x30a1, 0x30a2], // ァ→ア
  [0x30a3, 0x30a4], // ィ→イ
  [0x30a5, 0x30a6], // ゥ→ウ
  [0x30a7, 0x30a8], // ェ→エ
  [0x30a9, 0x30aa], // ォ→オ
  [0x30c3, 0x30c4], // ッ→ツ
  [0x30e3, 0x30e4], // ャ→ヤ
  [0x30e5, 0x30e6], // ュ→ユ
  [0x30e7, 0x30e8], // ョ→ヨ
  [0x30ee, 0x30ef], // ヮ→ワ
  [0x30f5, 0x30ab], // ヵ→カ
  [0x30f6, 0x30b1] // ヶ→ケ
])

export function normalize(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    const mapped = SMALL_TO_LARGE.get(cp)
    out += mapped !== undefined ? String.fromCodePoint(mapped) : ch
  }
  return out
}

export class Deduper {
  private history: string[] = []

  shouldEmit(text: string): boolean {
    const trimmed = text.trim()
    if (trimmed.length < MIN_OVERLAP) return trimmed.length > 0
    const norm = normalize(trimmed)
    for (const prev of this.history) {
      if (prev.includes(norm) || norm.includes(prev)) {
        return false
      }
    }
    this.history.push(norm)
    if (this.history.length > HISTORY_SIZE) this.history.shift()
    return true
  }

  reset(): void {
    this.history = []
  }
}
