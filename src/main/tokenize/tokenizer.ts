import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import kuromoji, { type IpadicFeatures, type Tokenizer as KTokenizer } from 'kuromoji'

const require = createRequire(import.meta.url)
const dicPath = dirname(require.resolve('kuromoji/dict/base.dat.gz'))

export interface Token {
  surface: string
  reading: string
  lemma: string
  pos: string
  posDetail: string
  cType: string
  cForm: string
  start: number
  end: number
}

let tokenizer: KTokenizer<IpadicFeatures> | null = null
let initPromise: Promise<KTokenizer<IpadicFeatures>> | null = null

function init(): Promise<KTokenizer<IpadicFeatures>> {
  if (tokenizer) return Promise.resolve(tokenizer)
  if (initPromise) return initPromise
  initPromise = new Promise((resolveFn, rejectFn) => {
    kuromoji.builder({ dicPath }).build((err, t) => {
      if (err) {
        initPromise = null
        rejectFn(err)
        return
      }
      tokenizer = t
      resolveFn(t)
    })
  })
  return initPromise
}

const KATA_TO_HIRA_OFFSET = 0x60

function kataToHira(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0
    // Katakana U+30A1..U+30F6 → Hiragana U+3041..U+3096
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code - KATA_TO_HIRA_OFFSET)
    } else {
      out += ch
    }
  }
  return out
}

function unstar(value: string | undefined, fallback: string): string {
  if (!value || value === '*') return fallback
  return value
}

export async function tokenize(line: string): Promise<Token[]> {
  const t = await init()
  const raw = t.tokenize(line)
  let cursor = 0
  return raw.map((tk) => {
    const surface = tk.surface_form
    const start = cursor
    const end = cursor + [...surface].length
    cursor = end
    return {
      surface,
      reading: kataToHira(unstar(tk.reading, surface)),
      lemma: unstar(tk.basic_form, surface),
      pos: tk.pos,
      posDetail: tk.pos_detail_1,
      cType: tk.conjugated_type,
      cForm: tk.conjugated_form,
      start,
      end
    }
  })
}

// Eagerly initialize at module import so the first tokenize() call is fast.
export function preloadTokenizer(): Promise<KTokenizer<IpadicFeatures>> {
  return init()
}
