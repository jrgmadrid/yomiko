<div align="center">
  <img src="assets/yomiko.jpg" alt="Yomiko Readman" width="180" />

  # yomiko

  *A Japanese visual novel reader. Capture the window, OCR the text, hover for dictionary, translate per line.*
</div>

---

## What this is

Most of the Japanese-VN learning stack on macOS is duct tape: `owocr` piping text into a browser running [Renji](https://renji-xd.github.io/texthooker-ui/) or [Kizuna](https://kizuna-texthooker-ui.app/), Yomitan in that browser for popups, copy-paste into DeepL in another tab for whole-line translation. On Windows it's Textractor + GameSentenceMiner + Yomitan + LunaTranslator.

Yomiko packages the same workflow into one app:

- **Capture any window** with one click from a picker.
- **Hover popups attach to the VN's own rendered text** via screen-coord hit zones. No parsed-text duplicate bar.
- **Whole-line machine translation** shown beneath the source. Coexists with the popups.
- **Sentence mining to Anki** on a hotkey *(planned)*.
- **Textractor WebSocket source** as a fallback for ornamented titles where OCR struggles.

[PLAN.md](PLAN.md) covers the architecture and the approaches that got rejected.

## Status

- **macOS**: working end-to-end on Apple Silicon (Sonoma+). Apple Vision OCR via a Swift sidecar, window position via `CGWindowListCopyWindowInfo`. Hover popups, dictionary lookup, deinflection, and machine translation are all functional.
- **Windows**: in progress. The OCR sidecar (`Windows.Media.Ocr` via C#) exists in source; it needs compilation and per-line bbox extension. A `DwmGetWindowAttribute`-based window-info sidecar still needs to be written.
- **Distribution**: dev-only. Code signing, notarization, and auto-updater are later work.

## Quick start

```bash
npm install                       # also builds Mac sidecars via postinstall
npm run build:dict                # one-time: builds the JMdict SQLite
export DEEPSEEK_API_KEY=...       # or DEEPL_API_KEY=...; either enables translation
npm run dev
```

Click **select source** in the overlay, pick a window with Japanese text, hover.

For development without a real VN: `window.vnr.openTestVN()` in DevTools opens a fake VN with eight scripted lines (→ / Space to advance).

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
| Translation | DeepSeek (default) or DeepL (BYOK) via the pluggable `Translator` interface. OpenAI-compatible LLMs and a hosted proxy planned. |

## License

TBD. All rights reserved until I pick one.

---

<sub>Named for [Yomiko Readman](https://en.wikipedia.org/wiki/Read_or_Die), the paper master.</sub>
