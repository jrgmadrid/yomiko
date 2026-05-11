<div align="center">
  <img src="assets/yomiko.jpg" alt="Yomiko Readman" width="180" />

  # yomiko

  *A native Japanese visual novel reader. Capture the window, OCR the text, hover for dictionary, machine-translate the line.*
</div>

---

## What this is

Most of the Japanese-VN learning ecosystem on macOS is duct tape: `owocr` piping text into a browser tab running [Renji](https://renji-xd.github.io/texthooker-ui/) or [Kizuna](https://kizuna-texthooker-ui.app/), Yomitan in that browser for popups, copy-paste into DeepL in another tab for whole-line translation. On Windows the equivalent is Textractor + GameSentenceMiner + Yomitan + LunaTranslator stacked together.

Yomiko bundles all of that into one Electron app with a coherent UX:

- **Capture any window**, no setup beyond picking it from a list
- **Hover over the game's own rendered text** for Yomitan-quality dictionary popups (no parsed-text duplicate bar — the popups attach to the actual VN characters via screen-coord hit zones)
- **Whole-line machine translation** via DeepL, shown in a strip beneath the source — additive to the popups, not replacing them
- **Sentence mining to Anki** on a hotkey *(planned)*
- **Textractor WebSocket source** as a power-user fallback for ornamented titles where OCR struggles

The hover-on-text architecture is the load-bearing UX bet — see [PLAN.md](PLAN.md) for the design rationale and what got rejected along the way.

## Status

- **macOS**: validated end-to-end on Apple Silicon (Sonoma+). Apple Vision OCR via a Swift sidecar; window position tracking via `CGWindowListCopyWindowInfo`. Hover popups, machine translation, dictionary lookup, deinflection all working.
- **Windows**: in progress. The Win OCR sidecar (`Windows.Media.Ocr` via C#) exists in source but needs compilation + per-line bbox extension. A `DwmGetWindowAttribute`-based window-info sidecar still needs to be written.
- **Distribution**: dev-only right now. Code signing, notarization, and auto-updater land in a later ship.

See [PLAN.md](PLAN.md) for the ship-by-ship breakdown.

## Quick start

```bash
npm install                # also builds Mac sidecars via postinstall
npm run build:dict         # one-time: builds the JMdict SQLite
export DEEPL_API_KEY=...   # optional; without it, popups still work, translations just don't render
npm run dev
```

Then click **select source** in the overlay, pick a window with Japanese text, and hover.

For development without a real VN: `window.vnr.openTestVN()` in DevTools opens a fake VN window with eight scripted lines (→/Space to advance).

## Stack

| Concern | Choice |
|---|---|
| Runtime | Electron 39 LTS |
| Build | electron-vite + electron-builder |
| UI | React 19 + Tailwind 4 |
| Tokenizer | kuromoji (IPADIC) |
| Dictionary | JMdict-simplified → better-sqlite3 |
| Mac OCR | Apple Vision via Swift sidecar |
| Mac window tracking | CGWindowListCopyWindowInfo via Swift sidecar |
| Win OCR (in progress) | Windows.Media.Ocr via C# sidecar |
| Translation | DeepL Free/Pro via REST (pluggable `Translator` interface; DeepSeek + LLM-via-OpenAI-compatible queued) |

## License

TBD — currently all rights reserved. License selection is part of the pre-release distribution work.

---

<sub>Named for [Yomiko Readman](https://en.wikipedia.org/wiki/Read_or_Die), the paper master.</sub>
