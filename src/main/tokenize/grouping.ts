import type { Token } from './tokenizer'

export interface WordGroup {
  surface: string
  reading: string
  headLemma: string
  headPos: string
  start: number
  end: number
  tokens: Token[]
}

// Auxiliary verbs that attach to the preceding verb to form a compound.
// Includes (a) progressive/perfect auxiliaries (いる, ある, おる),
// (b) directional auxiliaries (くる, いく, ゆく), (c) aspectual (しまう,
// みる, おく), (d) benefactive (やる, もらう, くれる, あげる), and
// (e) causative/passive forms (させる, せる, られる, れる) which IPADIC
// tags as standalone 動詞 even though they're conjugational suffixes.
const AUX_VERB_LEMMAS = new Set([
  'いる',
  'ある',
  'おる',
  'くる',
  'いく',
  'ゆく',
  'しまう',
  'みる',
  'おく',
  'やる',
  'もらう',
  'くれる',
  'あげる',
  'させる',
  'せる',
  'られる',
  'れる'
])

function shouldAttach(group: WordGroup, tk: Token): boolean {
  const headIsVerbal = group.headPos === '動詞' || group.headPos === '形容詞'
  if (!headIsVerbal) return false

  // 助動詞 (auxiliary) — always attach. e.g. た, だ, ない, です, ます, たい.
  if (tk.pos === '助動詞') return true

  // 接続助詞 (conjunctive particle) — て, で, ば, etc. attach to verbal heads.
  if (tk.pos === '助詞' && tk.posDetail === '接続助詞') return true

  // Sub-verb that's actually serving as auxiliary (lemma in our list).
  if (tk.pos === '動詞' && AUX_VERB_LEMMAS.has(tk.lemma)) return true

  return false
}

export function groupTokens(tokens: Token[]): WordGroup[] {
  const groups: WordGroup[] = []
  for (const tk of tokens) {
    const last = groups[groups.length - 1]
    if (last && shouldAttach(last, tk)) {
      last.surface += tk.surface
      last.reading += tk.reading
      last.end = tk.end
      last.tokens.push(tk)
    } else {
      groups.push({
        surface: tk.surface,
        reading: tk.reading,
        headLemma: tk.lemma,
        headPos: tk.pos,
        start: tk.start,
        end: tk.end,
        tokens: [tk]
      })
    }
  }
  return groups
}
