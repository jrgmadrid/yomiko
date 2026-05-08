# yomiko — Plan

A native-feeling Japanese visual novel reader. Ingests game text from Textractor (via WebSocket), tokenizes it with a modern morphological analyzer, and shows Yomitan-quality hover dictionary popups in an always-on-top transparent overlay. Sentence mining to Anki on a hotkey. Runs on Mac and Windows.

## Why this exists

Today's ecosystem leaves users on both platforms duct-taping pieces together: Textractor + GameSentenceMiner + Yomitan-in-browser on Windows; `owocr` → browser tab running [Renji](https://renji-xd.github.io/texthooker-ui/) or [Kizuna](https://kizuna-texthooker-ui.app/) → Yomitan in that browser on Mac. Nothing ships a single, well-designed desktop app combining (1) Textractor-WS source, (2) Yomitan-grade popups, (3) Anki sentence mining, (4) polished onboarding. The closest existing thing — `meikipop` — is utility-grade Python with no Anki and no hook source.

That's the niche.

## Architecture summary

```
┌────────────────────────────────────────────────────────────────┐
│ Electron main process (Node)                                   │
│                                                                │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────┐  │
│   │ TextSource      │──▶│ Tokenizer       │──▶│ Dict lookup │  │
│   │  (pluggable)    │   │  (lindera-wasm) │   │ (sqlite +   │  │
│   │  ─ Textractor WS│   │  + deinflect    │   │  jmdict)    │  │
│   │  ─ Manual paste │   │  + ve grouping  │   │             │  │
│   │  ─ OCR (Ship 4) │   └─────────────────┘   └─────────────┘  │
│   └─────────────────┘                                          │
│           │                                                    │
│           │ IPC                                                │
│           ▼                                                    │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│ Renderer (overlay window: transparent, always-on-top, panel)   │
│                                                                │
│   ─ Tokenized line display                                     │
│   ─ Hover popups (Yomitan-style)                               │
│   ─ Click-through-except-hit-zones                             │
│   ─ Line history scrollback (Ship 2)                           │
│   ─ Mining hotkey → IPC → AnkiConnect (Ship 3)                 │
└────────────────────────────────────────────────────────────────┘
```

## Stack decisions

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Electron 33 LTS | Mature overlay/transparent-window story; LTS de-risks regressions |
| Language | TypeScript | TypeScript can be read fluently; agent quality high; ecosystem dense for this domain |
| Build | electron-vite | Modern, fast, less boilerplate than electron-forge |
| UI | React + Tailwind | Boring/correct; agents excellent at React; Svelte considered, rejected for tooling maturity |
| Tokenizer | `lindera-wasm` (UniDic) in main process | Actively maintained 2026; modern dictionary; one WASM blob, no native build |
| Dictionary | `jmdict-simplified` v3.6+ → `better-sqlite3` | Weekly upstream releases; sub-ms lookup; clean schema |
| Deinflection | Port Yomitan's `japanese-transforms.js` rules table to TS | Data-driven, ~200 LOC engine; avoid GPL runtime contamination |
| Word grouping | Reimplement `ve` logic in TS | Verb+auxiliary collapse, copula chains — what makes per-word lookup feel right |
| Anki integration | AnkiConnect v6 from main process (bypass CORS) | Canonical now at `git.sr.ht/~foosoft/anki-connect`; GitHub repo archived 2025-11 |
| Storage | `~/Library/Application Support/yomiko/` (Mac), `%APPDATA%/yomiko/` (Win) | OS conventions; SQLite for dict + history, JSON for settings |

## Source abstraction

```ts
interface TextSource {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: 'text', listener: (line: string) => void): void;
  on(event: 'status', listener: (s: 'connected' | 'reconnecting' | 'disconnected') => void): void;
}
```

- **`TextractorWSSource`** (Ship 1) — connects to `ws://127.0.0.1:6677` (kuroahna's extension, hardcoded port). Exponential backoff reconnect (server starts lazily after Textractor selects a thread). Plain-text payload — one message = one line.
- **`ManualPasteSource`** (Ship 1) — paste box for testing without Textractor running. Bonus: useful for static text snippets.
- **`OCRSource`** (Ship 4) — region select + Apple Vision (Mac) or manga-ocr ONNX (cross-platform fallback). Polls region for changes, OCRs on diff.

## Overlay window config (key snippet, Mac+Win compatible)

```ts
const win = new BrowserWindow({
  width: 1280, height: 200,
  transparent: true, frame: false,
  resizable: false, hasShadow: false,
  skipTaskbar: true, focusable: false,
  alwaysOnTop: true,
  type: process.platform === 'darwin' ? 'panel' : undefined,
  backgroundColor: '#00000000',
  webPreferences: { contextIsolation: true, backgroundThrottling: false },
});
win.setAlwaysOnTop(true, 'screen-saver');
if (process.platform === 'darwin') {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}
win.showInactive();
```

Click-through pattern: `setIgnoreMouseEvents(true, { forward: true })`, toggled per-element via `elementFromPoint` on `mousemove` (re-checked each rAF on Win to work around flicker bug #35030). Re-issue on `did-finish-load` after every reload (#15376).

## Ship phases

> **Re-ordering note (2026-05-08):** original Ship 2 (settings/polish) and Ship 4 (OCR) swapped. Rationale: a one-click window-capture-plus-OCR flow is the demo-friendly "this works out of the box" experience, and turning Textractor into a power-user toggle behind it is a stronger product cut than shipping more polish on the existing Textractor-first path. Ship 1 already proved the reader works; the next ship should be the thing that lets a stranger use the app without 15 minutes of Wine setup.

### Ship 1 — MVP "I can read a VN with this" — **DONE** ✓ (2026-05-08)

Reader pipeline working end-to-end with kuromoji + JMdict popups. Commits `b35efec` … `86f46b7` on `main`.

**Material pivots from original plan:**
- Tokenizer: `lindera-wasm` → `kuromoji@0.1.2` + IPADIC. lindera-nodejs ships an empty package on npm (build-from-source only) and lindera-wasm has no Node WASM filesystem access. kuromoji's older dictionary is acceptable for Ship 1; modernization deferred.
- Deinflector: scope-cut from a full Yomitan rules port to a thin lemma-first lookup pipeline, since kuromoji already produces dictionary forms. Multi-step deinflection chains for the popup land in the renumbered Ship 4.

### Ship 2 — One-click OCR + window capture (was Ship 4)

The "demo this in 30 seconds" experience. Removes Textractor as a hard dependency for the default flow.

- [ ] **Window picker** — list running windows (Mac: `SCShareableContent` via ScreenCaptureKit; Win: `Windows.Graphics.Capture` via WinRT bindings). User clicks "select VN window."
- [ ] **Region selector** — drag a rectangle over the captured frame to mark the textbox. Persist per-window-title so reopening the same VN remembers it.
- [ ] **Frame diff** — compare crop hash between frames at ~10Hz. Only fire OCR when pixels change beyond threshold.
- [ ] **OCR backends** behind a `TextSource`-shaped interface so it slots into the existing pipeline:
  - Mac default: Apple Vision (`VNRecognizeTextRequest` with `recognitionLanguages: ["ja"]`) via a small Swift helper or `node-objc`/native module.
  - Win default: OneOCR (built into Win 11 since 23H2) via WinRT.
  - Opt-in heavy mode: manga-ocr ONNX (~400MB) for ornamented/calligraphic VNs (Type-Moon-flavored, KKK-tier) where Vision/OneOCR fail.
- [ ] **Text-effect handling** — debounce briefly to let typewriter-style rollouts complete before OCR-ing; commit only on stable frames.
- [ ] **Source toggle in UI** — per-source status pip in the bar (OCR vs Textractor-WS vs Manual). Both can run; OCR is default-on, Textractor stays available behind a setting.

**Definition of done:** install, launch, click "select window," drag textbox, read VN. Zero terminal commands required after install.

### Ship 3 — Sentence mining

(Unchanged — Anki integration always belonged after the source layer is solid.)

- [ ] AnkiConnect v6 client in main process
- [ ] One-hotkey card creation: current sentence + hovered word + screenshot of the captured window region
- [ ] Audio capture from VN window (CoreAudio tap on Mac, WASAPI loopback on Win — both painful, may push to Ship 3.5)
- [ ] Card template config (deck, model, field mapping)
- [ ] First-run AnkiConnect permission flow

### Ship 4 — Daily-use polish (was Ship 2) + Textractor as power-user mode

- [ ] Settings window (font family/size, opacity, hotkey, source priority, dict toggles)
- [ ] Line history scrollback (last 200 lines, click to re-show, persisted to SQLite)
- [ ] Hotkeys: show/hide overlay, force re-render, jump to last line
- [ ] Tray icon
- [ ] Pitch accent overlay in popup (using NHK pitch accent dict if user imports)
- [ ] Frequency dict support (BCCWJ, JPDB)
- [ ] Yomitan deinflection rules table fully ported, multi-step chains rendered in popup
- [ ] Modern tokenizer pivot (sudachi-via-subprocess or fully-WASI-bound lindera) to retire the 2007-era IPADIC
- [ ] Textractor-WS source surfaced in settings as "advanced" toggle for ornamented titles

### Ship 5 — Distribution

- [ ] Code signing + notarization (Mac)
- [ ] Authenticode signing (Win)
- [ ] Auto-update via electron-updater
- [ ] Proper installers (.dmg / .exe via electron-builder)
- [ ] Crash reporting (sentry-electron, opt-in)
- [ ] Public release / open-source decision

## Open questions / deferred

- **Audio capture for Ship 3** is genuinely hard cross-platform; may need a separate research spike before Ship 3 starts. Worst case: defer to "user records via OBS, GSM-style file watching" — but that loses the all-in-one promise.
- **Dictionary distribution**: bundled vs. downloaded on first run. Lean toward downloaded (~12MB gzipped JMdict) so installer stays slim; Ship 5 question.
- **Multi-game profile support**: per-game settings (region for OCR, dict overrides, mining deck). Lands naturally in Ship 2 since region-per-window-title needs persistence anyway.
- **Color/theme**: not yet designed. Default to dark, glassy, low-contrast against game; expose CSS injection for users who want to restyle.
- **OCR text-effect handling**: typewriter rollouts, fade-ins, partial reveals — research how `OwOcr` handles them; may need configurable debounce per game.
- **manga-ocr packaging**: 400MB ONNX model is too large to bundle in the installer. Download-on-first-use when the user opts into heavy-mode OCR.

## Known platform limits

- **Windows exclusive fullscreen** breaks the overlay AND breaks `Windows.Graphics.Capture` for Ship 2. Most modern engines (KiriKiri, Ren'Py, Unity) use borderless windowed. Document the limit; direct users to switch to windowed mode if needed.
- **Hardware-accelerated transparency bug #40515** affects some GPU drivers. Expose `disableHardwareAcceleration` toggle in settings.
- **macOS Tahoe Electron lag reports** (mjtsai 2025-09) — load-test on Tahoe before Ship 2 ships.
- **OCR quality cliff** for ornamented/calligraphic VNs (Kajiri Kamui Kagura tier — vertical text, decorative fonts, low-contrast scenes). Apple Vision and OneOCR fail; manga-ocr does meaningfully better but still struggles. These titles will always read better via Textractor hooks; that's why hooks remain available in Ship 4 polish phase.

## References

- [kuroahna/textractor_websocket](https://github.com/kuroahna/textractor_websocket) — canonical Textractor WS extension
- [lindera/lindera-wasm](https://github.com/lindera/lindera-wasm) — primary tokenizer
- [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified) — dictionary source
- [yomidevs/yomitan](https://github.com/yomidevs/yomitan) — UX reference + deinflection rules source
- [git.sr.ht/~foosoft/anki-connect](https://git.sr.ht/~foosoft/anki-connect) — AnkiConnect canonical
- [bpwhelan/GameSentenceMiner](https://github.com/bpwhelan/GameSentenceMiner) — Windows incumbent; UX patterns to study
- [HIllya51/LunaTranslator](https://github.com/HIllya51/LunaTranslator) — feature breadth reference
- [AuroraWright/owocr](https://github.com/AuroraWright/owocr) — OCR backend reference for Ship 4
- [TheMoeWay VN Mac guide](https://learnjapanese.moe/vn-mac/) — current Mac VN setup baseline
