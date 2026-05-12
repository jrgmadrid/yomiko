// Ship 2.7 — per-character refinement OCR for Apple Vision context bias.
//
// Vision misreads a visually-similar kanji as one that appeared earlier
// in the same input. On Test VN line 12 the correct 言 in 言われ biases
// the later 信 into a second 言, producing an OCR line where 言 appears
// twice when the source only has it once. We crop the original PNG
// around each repeated-kanji occurrence and re-OCR. Without the line
// context the bias has no anchor: the misread char re-reads as its
// true glyph, and a genuine repeat re-reads as itself.

import { nativeImage } from 'electron'
import type { OcrBackend, OcrLine, OcrRect, OcrResult } from './types'

const KANJI_REGEX = /[㐀-鿿]/
// Narrow pad: wider values empirically leak slivers of the next cell into
// the crop (Vision returns the target kanji plus a stray ">" or "i").
const CROP_PAD_PX = 4

function repeatedKanjiIndices(text: string): number[] {
  const chars = [...text]
  const counts = new Map<string, number>()
  for (const c of chars) if (KANJI_REGEX.test(c)) counts.set(c, (counts.get(c) ?? 0) + 1)
  const out: number[] = []
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]
    if (c && (counts.get(c) ?? 0) > 1) out.push(i)
  }
  return out
}

function cropAround(png: Buffer, rect: OcrRect): Buffer | null {
  const img = nativeImage.createFromBuffer(png)
  const { width: imgW, height: imgH } = img.getSize()
  const x = Math.max(0, Math.floor(rect.x - CROP_PAD_PX))
  const y = Math.max(0, Math.floor(rect.y - CROP_PAD_PX))
  const w = Math.min(imgW - x, Math.ceil(rect.w + CROP_PAD_PX * 2))
  const h = Math.min(imgH - y, Math.ceil(rect.h + CROP_PAD_PX * 2))
  const cropped = img.crop({ x, y, width: w, height: h })
  return cropped.isEmpty() ? null : cropped.toPNG()
}

export async function refineResult(
  png: Buffer,
  result: OcrResult,
  backend: OcrBackend
): Promise<OcrResult> {
  const work: { line: OcrLine; indices: number[] }[] = result.lines.map((l) => ({
    line: { ...l, chars: [...l.chars] },
    indices: repeatedKanjiIndices(l.text)
  }))
  const total = work.reduce((n, w) => n + w.indices.length, 0)
  if (total === 0) return result

  console.log(
    `[refine] ${total} repeated-kanji occurrence(s) across ${result.lines.length} line(s)`
  )

  for (const { line, indices } of work) {
    for (const idx of indices) {
      const charBox = line.chars[idx]
      if (!charBox) continue
      const before = charBox.text
      const crop = cropAround(png, charBox.rect)
      if (!crop) continue
      let recognized: string
      try {
        const recheck = await backend.recognize(crop)
        recognized = recheck.lines.map((l) => l.text).join('').trim()
      } catch (err) {
        console.error(`[refine] '${before}' @${idx}: ${(err as Error).message}`)
        continue
      }
      // Single-char acceptance: the crop is one glyph wide, so multi-char
      // output means stray punctuation/whitespace leaked in from the
      // padding and splicing it would corrupt the line.
      const after = [...recognized]
      const replacement = after[0]
      if (after.length !== 1 || !replacement || !KANJI_REGEX.test(replacement)) {
        console.log(`[refine] '${before}' @${idx} → "${recognized}" rejected`)
        continue
      }
      if (replacement === before) {
        console.log(`[refine] '${before}' @${idx} confirmed`)
        continue
      }
      console.log(`[refine] '${before}' @${idx} → '${replacement}'`)
      const chars = [...line.text]
      chars[idx] = replacement
      line.text = chars.join('')
      line.chars[idx] = { text: replacement, rect: charBox.rect }
    }
  }
  return { lines: work.map((w) => w.line) }
}
