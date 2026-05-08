import { resolve } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import Database, { type Database as Db } from 'better-sqlite3'

export interface JmdictKanji {
  common: boolean
  text: string
  tags: string[]
}

export interface JmdictKana {
  common: boolean
  text: string
  tags: string[]
  appliesToKanji: string[]
}

export interface JmdictGloss {
  lang: string
  text: string
  type?: string
}

export interface JmdictSense {
  partOfSpeech: string[]
  appliesToKanji: string[]
  appliesToKana: string[]
  field: string[]
  dialect: string[]
  misc: string[]
  info: string[]
  gloss: JmdictGloss[]
}

export interface JmdictEntry {
  id: number
  kanji: JmdictKanji[]
  kana: JmdictKana[]
  senses: JmdictSense[]
  matchedForm: string
  matchedIsKanji: boolean
}

let db: Db | null = null
type LookupRow = { id: number; kanji: string; kana: string; senses: string; is_kanji: number }
let lookupStmt: ReturnType<Db['prepare']> | null = null

function dbPath(): string {
  if (is.dev) {
    return resolve(app.getAppPath(), 'resources', 'dict', 'jmdict.db')
  }
  return resolve(process.resourcesPath, 'dict', 'jmdict.db')
}

function open(): Db {
  if (db) return db
  db = new Database(dbPath(), { readonly: true, fileMustExist: true })
  db.pragma('journal_mode = OFF')
  db.pragma('synchronous = OFF')
  lookupStmt = db.prepare(`
    SELECT e.id AS id, e.kanji AS kanji, e.kana AS kana, e.senses AS senses, f.is_kanji AS is_kanji
    FROM forms f
    JOIN entries e ON e.id = f.entry_id
    WHERE f.form = ?
    ORDER BY f.is_kanji DESC, e.id ASC
  `)
  return db
}

export function lookup(form: string): JmdictEntry[] {
  open()
  if (!lookupStmt) return []
  const rows = lookupStmt.all(form) as LookupRow[]
  return rows.map((r) => ({
    id: r.id,
    kanji: JSON.parse(r.kanji) as JmdictKanji[],
    kana: JSON.parse(r.kana) as JmdictKana[],
    senses: JSON.parse(r.senses) as JmdictSense[],
    matchedForm: form,
    matchedIsKanji: r.is_kanji === 1
  }))
}

export function close(): void {
  if (db) {
    db.close()
    db = null
    lookupStmt = null
  }
}
