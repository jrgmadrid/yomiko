import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const FILE = 'anki-config.json'

/** Maps Anki note-type field names → keys of the MiningInput payload. The
 *  user edits this in anki-config.json to match their card template. Values
 *  not in the MiningInput key set are dropped at compose time with a warn. */
export type FieldMap = Record<string, MiningField>

export type MiningField =
  | 'surface'
  | 'reading'
  | 'glosses'
  | 'sentence'
  | 'sentenceTranslation'
  | 'pictureHtml'

export interface AnkiConfig {
  ankiConnectUrl: string
  deckName: string
  modelName: string
  tags: string[]
  allowDuplicate: boolean
  fieldMap: FieldMap
}

const DEFAULT_CONFIG: AnkiConfig = {
  ankiConnectUrl: 'http://127.0.0.1:8765',
  deckName: 'Mining',
  modelName: 'jp-mining-note',
  tags: ['yomiko'],
  allowDuplicate: false,
  fieldMap: {
    Word: 'surface',
    WordReading: 'reading',
    WordMeaning: 'glosses',
    Sentence: 'sentence',
    SentenceTranslation: 'sentenceTranslation',
    Picture: 'pictureHtml'
  }
}

let cached: AnkiConfig | null = null

async function pathFor(): Promise<string> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  return join(dir, FILE)
}

export async function getAnkiConfig(): Promise<AnkiConfig> {
  if (cached) return cached
  try {
    const raw = await readFile(await pathFor(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AnkiConfig>
    cached = { ...DEFAULT_CONFIG, ...parsed, fieldMap: { ...DEFAULT_CONFIG.fieldMap, ...(parsed.fieldMap ?? {}) } }
    return cached
  } catch {
    cached = DEFAULT_CONFIG
    // Write defaults on first load so the user has a file to edit.
    try {
      await writeFile(await pathFor(), JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8')
    } catch (err) {
      console.warn(`[anki-config] could not write defaults: ${(err as Error).message}`)
    }
    return cached
  }
}
