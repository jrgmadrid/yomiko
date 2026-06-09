import {
  Channels,
  type MiningResultPayload,
  type SharedWordGroup,
  type SubmitToAnkiRequest
} from '@shared/ipc'
import {
  addNote,
  ankiVersion,
  AnkiDuplicateError,
  AnkiUnreachableError,
  storeMediaFile
} from './anki/client'
import { composeNote, type MiningInput } from './anki/compose'
import { lookupGroup } from './dict/deinflect'
import { resolveLatchedLine } from './frame-latch'
import { getAnkiConfig } from './storage/anki-config'
import { sendToOverlay } from './window'

// Cmd+Shift+M → mine the currently hovered token (or focused line) to
// Anki. The renderer holds the live hover state, so the hotkey only triggers
// over IPC; the renderer responds with a SubmitToAnkiRequest, and main
// composes the card from the frame latch + dict lookup + AnkiConnect.

function sendMiningResult(payload: MiningResultPayload): void {
  sendToOverlay(Channels.miningResult, payload)
}

function extractGlosses(group: SharedWordGroup): string[] | null {
  const result = lookupGroup(group)
  const entry = result.entries[0]
  if (!entry) return null
  // Numbered glosses, one sense per line. Matches the readable format of
  // jp-mining-note's WordMeaning field without HTML; users with HTML-rich
  // templates can post-process.
  return entry.senses.map((sense, i) => {
    const text = sense.gloss.map((g) => g.text).join('; ')
    return `${i + 1}. ${text}`
  })
}

export async function handleSubmitToAnki(req: SubmitToAnkiRequest): Promise<void> {
  const resolved = resolveLatchedLine(req.frameId, req.lineIdx)
  if (!resolved.ok) {
    console.log(`[mining] ${resolved.message}; dropping`)
    sendMiningResult({ ok: false, error: resolved.error, message: resolved.message })
    return
  }
  const { line, crop } = resolved

  const config = await getAnkiConfig()
  const filename = `yomiko-${Date.now()}.png`
  const sentence = req.vlmText ?? line.text

  let reading: string | null = null
  let glosses: string[] | null = null
  if (req.hoveredGroup) {
    reading = req.hoveredGroup.reading || null
    glosses = extractGlosses(req.hoveredGroup)
  }

  const input: MiningInput = {
    surface: req.hoveredSurface,
    reading,
    glosses,
    sentence,
    sentenceTranslation: req.vlmTranslation,
    pictureFilename: filename
  }

  console.log(
    `[mining] frame=${req.frameId} line=${req.lineIdx} surface="${req.hoveredSurface ?? '(none)'}" → ${config.deckName}/${config.modelName}`
  )

  try {
    await storeMediaFile({ filename, data: crop.toString('base64') }, config.ankiConnectUrl)
    const payload = composeNote(input, config)
    const noteId = await addNote(payload, config.ankiConnectUrl)
    console.log(`[mining] addNote ok, noteId=${noteId}`)
    sendMiningResult({ ok: true, noteId })
  } catch (err) {
    if (err instanceof AnkiUnreachableError) {
      console.warn(`[mining] AnkiConnect unreachable: ${err.message}`)
      sendMiningResult({ ok: false, error: 'ANKI_UNREACHABLE', message: err.message })
    } else if (err instanceof AnkiDuplicateError) {
      console.log(`[mining] duplicate rejected: ${err.message}`)
      sendMiningResult({ ok: false, error: 'DUPLICATE', message: err.message })
    } else {
      const msg = (err as Error).message
      console.warn(`[mining] addNote failed: ${msg}`)
      sendMiningResult({ ok: false, error: 'ANKI_ERROR', message: msg })
    }
  }
}

/** Best-effort connectivity probe at startup so the user knows up-front
 *  whether Anki is reachable. The mining hotkey re-checks per-call. */
export async function probeAnkiConnect(): Promise<void> {
  try {
    const config = await getAnkiConfig()
    const v = await ankiVersion(config.ankiConnectUrl)
    console.log(`[anki] AnkiConnect detected (v${v}) at ${config.ankiConnectUrl}`)
  } catch (err) {
    console.log(
      `[anki] not reachable on startup: ${(err as Error).message} — mining will surface errors when used`
    )
  }
}
