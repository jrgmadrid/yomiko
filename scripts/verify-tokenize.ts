// Smoke test for the kuromoji tokenizer wrapper.
// Run: npx tsx scripts/verify-tokenize.ts (from yomiko)

import { tokenize, preloadTokenizer } from '../src/main/tokenize/tokenizer'

async function main(): Promise<void> {
  await preloadTokenizer()

  const samples = [
    '今日はいい天気だ。',
    '彼女は本を読んでいた。',
    '猫が窓辺で眠っている。',
    '食べさせられたくなかった'
  ]

  for (const s of samples) {
    console.log(`\n→ ${s}`)
    const tokens = await tokenize(s)
    for (const tk of tokens) {
      console.log(
        `  ${tk.surface.padEnd(8)}  pos=${tk.pos.padEnd(4)}  reading=${tk.reading.padEnd(8)}  lemma=${tk.lemma}`
      )
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
