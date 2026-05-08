import Database from 'better-sqlite3'
const db = new Database('/Users/dev/Documents/Projects/yomiko/resources/dict/jmdict.db', { readonly: true })
const stmt = db.prepare(`
  SELECT e.id, e.kanji, e.kana, e.senses
  FROM forms f
  JOIN entries e ON e.id = f.entry_id
  WHERE f.form = ?
  ORDER BY f.is_kanji DESC, e.id ASC
  LIMIT 3
`)
for (const word of ['猫', '読む', '食べる', '天気', 'ねこ']) {
  console.log(`\n→ lookup '${word}'`)
  const t0 = performance.now()
  const rows = stmt.all(word) as { id: number; kanji: string; kana: string; senses: string }[]
  const t1 = performance.now()
  console.log(`  ${rows.length} hits in ${(t1 - t0).toFixed(2)}ms`)
  for (const r of rows.slice(0, 1)) {
    const kanji = JSON.parse(r.kanji) as { text: string }[]
    const kana = JSON.parse(r.kana) as { text: string }[]
    const senses = JSON.parse(r.senses) as { gloss: { text: string }[] }[]
    console.log(`    [${r.id}] ${kanji.map(k=>k.text).join('・') || '(kana)'} (${kana.map(k=>k.text).join('・')}) :: ${senses[0]?.gloss?.map(g=>g.text).slice(0,3).join('; ')}`)
  }
}
db.close()
