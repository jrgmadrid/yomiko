import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const FILE = 'anki-config.json'

export const MINING_FIELDS = [
  'surface',
  'reading',
  'glosses',
  'sentence',
  'sentenceTranslation',
  'pictureHtml'
] as const

export type MiningField = (typeof MINING_FIELDS)[number]

/** Maps Anki note-type field names → keys of the MiningInput payload. The
 *  user edits this in anki-config.json to match their card template.
 *  Sanitized at load time, so consumers can trust every value. */
export type FieldMap = Record<string, MiningField>

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

// Drop fieldMap entries whose value isn't a MiningInput key, with a warn —
// a typo in the user's hand-edited map should cost that one field, not the
// whole config. Validating here (not at compose time) means composeNote
// receives a trusted FieldMap and needs no runtime guard.
function sanitizeFieldMap(raw: unknown): FieldMap {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG.fieldMap }
  const out: FieldMap = {}
  for (const [ankiField, key] of Object.entries(raw)) {
    if ((MINING_FIELDS as readonly string[]).includes(key as string)) {
      out[ankiField] = key as MiningField
    } else {
      console.warn(
        `[anki-config] field "${ankiField}" mapped to unknown key "${String(key)}"; dropping`
      )
    }
  }
  return out
}

export async function getAnkiConfig(): Promise<AnkiConfig> {
  if (cached) return cached
  const path = await pathFor()

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    // Missing file is the expected first run: write defaults so the user
    // has a file to edit. Any other read error: defaults in memory only.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        await writeFile(path, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8')
      } catch (writeErr) {
        console.warn(`[anki-config] could not write defaults: ${(writeErr as Error).message}`)
      }
    } else {
      console.warn(`[anki-config] read failed: ${(err as Error).message}; using defaults`)
    }
    cached = DEFAULT_CONFIG
    return cached
  }

  let parsed: Partial<AnkiConfig>
  try {
    parsed = JSON.parse(raw) as Partial<AnkiConfig>
  } catch (err) {
    // The file exists but isn't valid JSON — almost certainly a hand-edit
    // typo. Never overwrite it: the user's mapping is still in there.
    // Deliberately not cached, so fixing the file works without a restart.
    console.warn(
      `[anki-config] ${FILE} is not valid JSON (${(err as Error).message}); ` +
        'using defaults until it parses — file left untouched'
    )
    return DEFAULT_CONFIG
  }

  cached = {
    ...DEFAULT_CONFIG,
    ...parsed,
    fieldMap: parsed.fieldMap ? sanitizeFieldMap(parsed.fieldMap) : { ...DEFAULT_CONFIG.fieldMap }
  }
  return cached
}
