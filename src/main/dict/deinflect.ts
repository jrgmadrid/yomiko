// Lookup pipeline for word groups → JMdict entries.
//
// Ship 1 strategy: kuromoji already produces the dictionary form (lemma) for
// most morphemes, so we lean on that and keep the deinflector small. We try
// in order:
//   1) the head lemma exactly (e.g. 食べる, 読む, 暑い, 学校)
//   2) the raw surface form (catches lemmaless tokens, names, expressions)
//   3) a handful of suffix-strip fallbacks for cases kuromoji mis-tags
//
// The fuller Yomitan rules-table port lands in Ship 2 alongside multi-step
// deinflection chains for display in the popup.

import { lookup as jmdictLookup, type JmdictEntry } from './jmdict'
import type { Token } from '../tokenize/tokenizer'
import type { WordGroup } from '../tokenize/grouping'

export interface DeinflectionStep {
  /** Surface segment that was stripped or transformed. */
  description: string
}

export interface LookupResult {
  /** The form actually matched in JMdict. */
  matched: string
  /** Conjugation breadcrumbs for the popup ("past, progressive"). */
  chain: DeinflectionStep[]
  entries: JmdictEntry[]
}

// Conjugation form (cForm in IPADIC) → human-readable label. Subset that
// covers most VN-text inflections.
const CFORM_LABELS: Record<string, string> = {
  '基本形': 'plain',
  '連用形': 'continuative',
  '連用タ接続': 'te-form',
  '連用テ接続': 'te-form',
  '未然形': 'irrealis',
  '未然ウ接続': 'volitional',
  '命令ｉ': 'imperative',
  '命令ｅ': 'imperative',
  '命令ｒｏ': 'imperative',
  '仮定形': 'conditional',
  '仮定縮約１': 'conditional',
  '体言接続': 'attributive'
}

const AUX_LABELS: Record<string, string> = {
  'た': 'past',
  'だ': 'past',
  'ない': 'negative',
  'ぬ': 'negative',
  'ん': 'negative',
  'ます': 'polite',
  'ました': 'polite past',
  'ませ': 'polite',
  'たい': 'desiderative',
  'たく': 'desiderative',
  'です': 'polite copula',
  'らしい': 'apparent',
  'そう': 'inferential',
  'う': 'volitional',
  'よう': 'volitional'
}

function describeChain(tokens: Token[]): DeinflectionStep[] {
  const steps: DeinflectionStep[] = []
  for (let i = 1; i < tokens.length; i += 1) {
    const tk = tokens[i]
    if (!tk) continue
    if (tk.pos === '助動詞') {
      const label = AUX_LABELS[tk.lemma]
      if (label) steps.push({ description: label })
      continue
    }
    if (tk.pos === '動詞' && tk.lemma) {
      // aux verb in compound form (いる, ある, しまう, etc.)
      steps.push({ description: tk.lemma })
      continue
    }
    if (tk.pos === '助詞' && tk.posDetail === '接続助詞') {
      // te-form linker — covered by previous token's cForm
      continue
    }
  }
  // Head's own conjugated form, if non-trivial
  const head = tokens[0]
  if (head && head.cForm && head.cForm !== '基本形') {
    const label = CFORM_LABELS[head.cForm]
    if (label && !steps.some((s) => s.description === label)) {
      steps.unshift({ description: label })
    }
  }
  return steps
}

// Last-ditch suffix strips for cases where kuromoji doesn't produce a clean
// lemma (rare, mostly compounds and irregular verbs the IPADIC corpus misses).
const SUFFIX_FALLBACKS: { suffix: string; replace: string }[] = [
  { suffix: 'ました', replace: 'る' },
  { suffix: 'ません', replace: 'る' },
  { suffix: 'ます', replace: 'る' },
  { suffix: 'なかった', replace: 'る' },
  { suffix: 'ない', replace: 'る' },
  { suffix: 'たい', replace: 'る' },
  { suffix: 'た', replace: 'る' }
]

function fallbackLookup(surface: string): JmdictEntry[] {
  for (const { suffix, replace } of SUFFIX_FALLBACKS) {
    if (surface.endsWith(suffix)) {
      const candidate = surface.slice(0, -suffix.length) + replace
      const hits = jmdictLookup(candidate)
      if (hits.length) return hits
    }
  }
  return []
}

export function lookupGroup(group: WordGroup): LookupResult {
  const chain = describeChain(group.tokens)

  // 1) Head lemma — what kuromoji already deinflected for us.
  const head = group.tokens[0]
  if (head?.lemma && head.lemma !== group.surface) {
    const hits = jmdictLookup(head.lemma)
    if (hits.length) return { matched: head.lemma, chain, entries: hits }
  }

  // 2) Raw surface (covers nouns, particles, names, compounds).
  const surface = group.surface
  const direct = jmdictLookup(surface)
  if (direct.length) return { matched: surface, chain: [], entries: direct }

  // 3) Re-try the head lemma even if it equals surface (for things like 学校).
  if (head?.lemma && head.lemma === group.surface) {
    const hits = jmdictLookup(head.lemma)
    if (hits.length) return { matched: head.lemma, chain, entries: hits }
  }

  // 4) Suffix-strip fallback.
  const fb = fallbackLookup(surface)
  if (fb.length) return { matched: fb[0]?.matchedForm ?? surface, chain, entries: fb }

  return { matched: surface, chain, entries: [] }
}
