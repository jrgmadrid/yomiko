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

function renderField(key: MiningField, input: MiningInput): string {
  switch (key) {
    case 'surface':
      return input.surface ?? ''
    case 'reading':
      return input.reading ?? ''
    case 'glosses':
      // Newline-separated. Renders cleanly in jp-mining-note's WordMeaning
      // field; users with HTML-rich templates can override the field map.
      return input.glosses?.join('\n') ?? ''
    case 'sentence':
      return input.sentence
    case 'sentenceTranslation':
      return input.sentenceTranslation ?? ''
    case 'pictureHtml':
      return `<img src="${input.pictureFilename}">`
  }
}

export function composeNote(input: MiningInput, config: AnkiConfig): AddNotePayload {
  // fieldMap is sanitized at load time (anki-config.ts), so every value
  // here is a valid MiningField.
  const fields: Record<string, string> = {}
  for (const [ankiFieldName, miningKey] of Object.entries(config.fieldMap)) {
    fields[ankiFieldName] = renderField(miningKey, input)
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
