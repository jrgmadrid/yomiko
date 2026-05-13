// Pure composer: turn the mining payload + user's field mapping into an
// AnkiConnect addNote body. No I/O, no electron deps — exists in its own
// file so unit-testing the mapping is straightforward if we ever want to.

import type { AddNotePayload } from './client'
import type { AnkiConfig, MiningField } from '../storage/anki-config'

export interface MiningInput {
  surface: string | null
  reading: string | null
  glosses: string[] | null
  sentence: string
  sentenceTranslation: string | null
  /** Filename stored via storeMediaFile. The composer wraps it as
   *  `<img src="...">` for fields mapped to `pictureHtml`. */
  pictureFilename: string
}

const VALID_FIELDS: ReadonlySet<MiningField> = new Set<MiningField>([
  'surface',
  'reading',
  'glosses',
  'sentence',
  'sentenceTranslation',
  'pictureHtml'
])

function renderField(key: MiningField, input: MiningInput): string {
  switch (key) {
    case 'surface':
      return input.surface ?? ''
    case 'reading':
      return input.reading ?? ''
    case 'glosses':
      return formatGlosses(input.glosses)
    case 'sentence':
      return input.sentence
    case 'sentenceTranslation':
      return input.sentenceTranslation ?? ''
    case 'pictureHtml':
      return `<img src="${input.pictureFilename}">`
  }
}

function formatGlosses(glosses: string[] | null): string {
  if (!glosses || glosses.length === 0) return ''
  // Newline-separated. Simple; renders cleanly in jp-mining-note's
  // WordMeaning field. Users with HTML-rich templates can override field
  // mapping or post-process.
  return glosses.join('\n')
}

export function composeNote(input: MiningInput, config: AnkiConfig): AddNotePayload {
  const fields: Record<string, string> = {}
  for (const [ankiFieldName, miningKey] of Object.entries(config.fieldMap)) {
    if (!VALID_FIELDS.has(miningKey as MiningField)) {
      console.warn(
        `[anki-compose] field "${ankiFieldName}" mapped to unknown key "${miningKey}"; dropping`
      )
      continue
    }
    fields[ankiFieldName] = renderField(miningKey as MiningField, input)
  }
  return {
    note: {
      deckName: config.deckName,
      modelName: config.modelName,
      fields,
      tags: config.tags,
      options: config.allowDuplicate ? { allowDuplicate: true } : undefined
    }
  }
}
