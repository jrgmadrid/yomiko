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
- **On-hover VLM translation** (Qwen2.5-VL via OpenRouter). Image-based, so it handles rare kanji, vertical text, and stylized fonts that defeat constrained-vocab OCR. Per-line, anchored beneath the hovered line.
- **JMdict popup behind Shift+hover** as a deliberate drilldown. Lookup is driven off the VLM-corrected transcription, so even Vision's substitution failures don't leak into the dictionary entry.
- **`⌘⇧T` force-translates the entire frame** for cases where OCR returns nothing at all (calligraphic title cards, Buddhist mantra panels, stylized banners).
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

# Translation requires the yomiko proxy URL + token. See proxy/README.md
# to stand up your own, or use the hosted instance the maintainer runs.
export YOMIKO_PROXY_URL=https://...
export YOMIKO_PROXY_TOKEN=...

npm run dev
```

Click **select source** in the overlay, pick a window with Japanese text, hover.

For development without a real VN: `window.vnr.openTestVN()` in DevTools opens a fake VN with ten scripted lines (→ / Space to advance). Line 10 is a Marishiten mantra — stress-tests rare-kanji transcription via the VLM.

## Hotkeys

| Key | Action |
|---|---|
| Hover a word | Translation overlay for the line |
| Shift + hover | Add the JMdict popup for the hovered word |
| `⌘⇧T` | Force-translate the entire frame (use when OCR sees nothing) |
| `⌘⇧H` | Toggle hover mode |
| `⌘⇧D` | Toggle debug rects (per-char OCR bboxes) |

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
| Translation | Image-based via Qwen2.5-VL on OpenRouter, routed through a Cloudflare Worker proxy so user installs don't ship the upstream API key. LRU cache keyed by Vision's first-pass text, persisted to disk across sessions. See [proxy/](proxy/) for the Worker source. |

## License

TBD. All rights reserved until I pick one.

---

<sub>Named for [Yomiko Readman](https://en.wikipedia.org/wiki/Read_or_Die), the paper master.</sub>
