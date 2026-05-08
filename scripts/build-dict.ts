// Downloads the latest jmdict-simplified release and builds a SQLite
// database for fast surface-form lookups.
//
// Output: resources/dict/jmdict.db (~30MB)
// Run:    npm run build:dict

import { mkdir, access, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { extract } from 'tar-stream'
import Database from 'better-sqlite3'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const dictDir = resolve(projectRoot, 'resources', 'dict')
const dbPath = resolve(dictDir, 'jmdict.db')

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface JmdictKanji {
  common: boolean
  text: string
  tags: string[]
}

interface JmdictKana {
  common: boolean
  text: string
  tags: string[]
  appliesToKanji: string[]
}

interface JmdictSense {
  partOfSpeech: string[]
  appliesToKanji: string[]
  appliesToKana: string[]
  related: unknown[]
  antonym: unknown[]
  field: string[]
  dialect: string[]
  misc: string[]
  info: string[]
  languageSource: unknown[]
  gloss: { lang: string; text: string; type?: string }[]
}

interface JmdictEntry {
  id: string
  kanji: JmdictKanji[]
  kana: JmdictKana[]
  sense: JmdictSense[]
}

interface JmdictRoot {
  version: string
  dictDate: string
  words: JmdictEntry[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fetchLatestAssetUrl(): Promise<string> {
  console.log('querying jmdict-simplified latest release')
  const res = await fetch('https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest')
  if (!res.ok) {
    throw new Error(`GitHub API failed: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { assets: ReleaseAsset[] }
  const tgz = data.assets.find(
    (a) => a.name.startsWith('jmdict-eng-') && !a.name.includes('common') && a.name.endsWith('.json.tgz')
  )
  if (!tgz) {
    throw new Error('jmdict-eng .json.tgz not found in latest release')
  }
  return tgz.browser_download_url
}

async function downloadAndExtract(url: string, outPath: string): Promise<void> {
  console.log(`↓ downloading ${url.split('/').pop()}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status}`)
  }

  const tarExtract = extract()
  let foundJson = false

  const writePromise = new Promise<void>((resolveFn, rejectFn) => {
    tarExtract.on('entry', (header, stream, next) => {
      if (header.name.endsWith('.json') && !foundJson) {
        foundJson = true
        const ws = createWriteStream(outPath)
        stream.pipe(ws)
        ws.on('finish', next)
        ws.on('error', rejectFn)
      } else {
        stream.on('end', next)
        stream.resume()
      }
    })
    tarExtract.on('finish', resolveFn)
    tarExtract.on('error', rejectFn)
  })

  await pipeline(
    Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createGunzip(),
    tarExtract
  )
  await writePromise
  if (!foundJson) throw new Error('no .json file in archive')
}

async function buildDb(
  jsonPath: string,
  outPath: string
): Promise<{ entries: number; forms: number }> {
  console.log('◇ building SQLite')
  const { readFile } = await import('node:fs/promises')
  const json = await readFile(jsonPath, 'utf8')
  const root = JSON.parse(json) as JmdictRoot

  const db = new Database(outPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    DROP TABLE IF EXISTS entries;
    DROP TABLE IF EXISTS forms;
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      kanji TEXT NOT NULL,
      kana TEXT NOT NULL,
      senses TEXT NOT NULL
    );
    CREATE TABLE forms (
      form TEXT NOT NULL,
      entry_id INTEGER NOT NULL,
      is_kanji INTEGER NOT NULL,
      PRIMARY KEY (form, entry_id, is_kanji)
    );
  `)

  const insertEntry = db.prepare(
    'INSERT INTO entries (id, kanji, kana, senses) VALUES (?, ?, ?, ?)'
  )
  const insertForm = db.prepare(
    'INSERT OR IGNORE INTO forms (form, entry_id, is_kanji) VALUES (?, ?, ?)'
  )

  let entries = 0
  let forms = 0
  const txn = db.transaction(() => {
    for (const w of root.words) {
      const id = parseInt(w.id, 10)
      insertEntry.run(
        id,
        JSON.stringify(w.kanji),
        JSON.stringify(w.kana),
        JSON.stringify(w.sense)
      )
      entries += 1
      for (const k of w.kanji) {
        insertForm.run(k.text, id, 1)
        forms += 1
      }
      for (const k of w.kana) {
        insertForm.run(k.text, id, 0)
        forms += 1
      }
    }
  })
  txn()
  db.exec('CREATE INDEX idx_forms_form ON forms(form);')
  db.close()
  return { entries, forms }
}

async function main(): Promise<void> {
  await mkdir(dictDir, { recursive: true })

  if (await exists(dbPath)) {
    console.log(`✓ ${dbPath} already exists — delete it to rebuild`)
    return
  }

  const url = await fetchLatestAssetUrl()
  const jsonPath = resolve(dictDir, 'jmdict-eng.json')
  await downloadAndExtract(url, jsonPath)

  const stats = await buildDb(jsonPath, dbPath)
  console.log(`✓ wrote ${stats.entries} entries, ${stats.forms} forms → ${dbPath}`)

  await rm(jsonPath)
}

main().catch((err) => {
  console.error('build:dict failed:', err)
  process.exit(1)
})
