# yomiko — Plan

A native-feeling Japanese visual novel reader. Captures the VN window, OCRs the visible text, and renders Yomitan-quality dictionary popups directly over the game's *own* rendered characters — no parsed-text duplicate, no rectangle-drag onboarding. Sentence mining to Anki on a hotkey. Textractor-WS source remains as a power-user fallback. Runs on Mac (validated) and Windows (parity work outstanding).

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
│   ─ Hover zones over captured window (screen-coord hit map)    │
│   ─ Yomitan-style popups attached to OCR'd tokens              │
│   ─ Click-through-except-hit-zones                             │
│   ─ Pill-bar token display (fallback / debug; default hidden)  │
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
- **`OCRSource`** (Ship 2) — capture entire window, Apple Vision (Mac) or `Windows.Media.Ocr` (Win, deferred). Stabilizer fires on hash change; emits structured `frame-ocr` events with line-level bboxes that the renderer turns into screen-coord hover zones. Heavy-mode manga-ocr ONNX deferred (see Open questions).

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

> **Consumer-surface pivot (2026-05-08, late session):** the "render parsed tokens in a translation pill bar" consumer was replaced with a hover-on-VN-text architecture — invisible click-through hit zones in screen coords over the captured window's *own* rendered text. Validated against Test VN + TextEdit; landed as Ship 2.5. The original pill bar still ships as a fallback (toggle Cmd+Shift+H or `?hover=off`) for weird layouts, but it's hidden by default. This eliminated the rectangle-drag onboarding step entirely (the `hasJapanese` filter handles chrome leakage) and removed the duplicate-text awkwardness of two surfaces showing the same line. Open questions about real-VN behavior moved from Ship 2 to Ship 2.5.

### Ship 1 — MVP "I can read a VN with this" — **DONE** ✓ (2026-05-08)

Reader pipeline working end-to-end with kuromoji + JMdict popups. Commits `b35efec` … `86f46b7` on `main`.

**Material pivots from original plan:**
- Tokenizer: `lindera-wasm` → `kuromoji@0.1.2` + IPADIC. lindera-nodejs ships an empty package on npm (build-from-source only) and lindera-wasm has no Node WASM filesystem access. kuromoji's older dictionary is acceptable for Ship 1; modernization deferred.
- Deinflector: scope-cut from a full Yomitan rules port to a thin lemma-first lookup pipeline, since kuromoji already produces dictionary forms. Multi-step deinflection chains for the popup land in the renumbered Ship 4.

### Ship 2 — One-click OCR + window capture (was Ship 4) — **DONE** ✓ (2026-05-08)

OCR pipeline (capture → diff → stabilizer → backend → emit) verified end-to-end. The original "render text into a pill bar" consumer was superseded mid-session by Ship 2.5 (hover-on-VN-text); real-VN dogfood and the Win sidecar parity work moved to Ship 2.5.

**What landed:**
- [x] **Window picker** — `desktopCapturer.getSources({ types: ['window' ]})` (Mac: routes through ScreenCaptureKit on macOS 14.4+; Win: `Windows.Graphics.Capture`). `setDisplayMediaRequestHandler` with `useSystemPicker: false` so we drive a custom drag-rectangle UX.
- [x] **Region selector** — `RegionSelector.tsx` drag-rectangle component over a live preview frame. Region persisted per-window-title to `userData/regions.json`.
- [x] **Frame diff** — 256-bit aHash (16×16 grid, mean-thresholded) computed in renderer per cropped frame; Hamming-distance stabilizer in main process with 350ms stabilization window and 800ms hard interval lock.
- [x] **OCR backends:**
  - Mac default: Apple Vision Swift CLI sidecar (`vendor/macos-vision-ocr/main.swift`, length-prefixed PNG over stdin → NDJSON over stdout). Spawned once, auto-restart on crash.
  - Win default: `Windows.Media.Ocr` C# sidecar (`vendor/windows-media-ocr/`). Source committed but binary is uncompiled — needs Win box or `dotnet publish` from Mac with .NET 9 SDK. Same protocol as Mac.
  - Heavy mode (manga-ocr ONNX) deferred to **Ship 2.5**.
- [x] **OCRSource** — extends `TextSource`, glues capture stream → diff → stabilizer → OCR backend → kana-normalized substring dedupe → emit. Same `text:line` channel as Textractor-WS source.
- [x] **Source picker UX** — multi-step modal (window list → live preview + region selector → confirm). Pip color reflects status. "Select source" / "Change source" CTA in the overlay bar.
- [x] **Distribution prep** — `electron-builder.yml` `extraResources` for sidecar binaries, postinstall builds the platform-appropriate sidecar.

**Definition of done (met):** install → launch → click "select source" → pick a window → live capture starts. Mac validated; Windows parity tracked under Ship 2.5.

### Dogfood notes (Ship 2)

These are the load-bearing lessons from the 2026-05-08 dogfood session — read before touching Ship 2 internals or planning Ship 2.5+:

**1. macOS ScreenCaptureKit throttles frame delivery for non-interacted windows.** When a captured target window's content updates (DOM change, repaint) without direct mouse interaction *inside that window*, SCK stops delivering fresh frames to `getDisplayMedia` consumers. Frames keep arriving — they're just stale. Highlighting text in the source breaks the spell because mouse-drag is "interaction." This is a real macOS Tahoe behavior, not an Electron bug.

**Workaround in tree:** for our owned Test VN BrowserWindow, we bypass `getDisplayMedia` entirely and poll `webContents.capturePage()` from main at 5fps. This pulls straight from Chromium's compositor for windows we own. See `pollTestVnFrame` in `src/main/index.ts`. **Not applicable to third-party VNs** — `capturePage` only works on BrowserWindows we control.

**Hypothesis for real VNs:** they render constantly via animations / particles / sprite blinking, so they never go idle long enough for SCK to throttle. Untested. If real VNs DO trip the throttle, the right fix is a Swift sidecar talking to `SCStream` directly with our chosen `SCStreamConfiguration` (explicit `minimumFrameInterval`, etc.) instead of going through Electron's `getDisplayMedia`. The sidecar pattern is already established for OCR.

**2. The architectural-refactor detour was wrong.** During the same dogfood session a sub-agent diagnosed the staleness as Chromium's `NativeWindowOcclusionTracker` pausing the source's compositor because our full-screen transparent overlay covered it. We restructured the overlay to a bottom strip + a separate popup BrowserWindow accordingly. The bug persisted — diagnosis was wrong (or at most partial). After identifying the SCK throttling cause, we reverted to the original full-screen overlay + inline popup architecture. **Lesson: when the agent's first diagnosis maps to a 200-line restructure, get the actual fix to validate before committing.**

**3. Hash sensitivity matters more than expected.** Initial dHash at 64 bits over a 9×8 grid produced Hamming deltas of 2-7 bits between distinct VN lines (background averaged out the text). Bumped to 256 bits (16×16) — still ≤ 7 bits. Switched from dHash (compares adjacent pixels) to aHash (compares each cell to global mean). aHash captures *where* the bright pixels are, which is what changes between VN lines. Distinct lines now produce 30-80 bit deltas. Stabilizer threshold is 20 bits over 256.

**4. Layout caveat.** The overlay bar grows upward as content gets tall (long wrapping dialogue). Without `max-h-[85vh]` + `overflow-y-auto`, the bar's header (status pip + select-source button) slides off the top of the screen. Same pattern in the picker modal. Fixed in `c805713`.

### Ship 2.5 — Hover-on-VN-text consumer — **PROTOTYPED** ✓ (2026-05-08)

Replaces the bottom translation pill with screen-coord hit zones over the captured window's *own* rendered text. The user mouses over the actual game text and gets the popup directly. No duplicate render; no rectangle-drag onboarding; chrome leakage is a feature (menus, scene signage, character name plates all become lookupable, filtered to CJK content via `hasJapanese`).

Validated against Test VN (capturePage path) and TextEdit (real-window path via getDisplayMedia). Commits `e9ef8fb` + `43d83fd` on `main`.

**Architecture additions on top of Ship 2:**
- `vendor/macos-window-info/` — Swift sidecar wrapping `CGWindowListCopyWindowInfo` for live screen-bounds tracking. Permission-free for `kCGWindowBounds` / `kCGWindowOwnerName` / `kCGWindowNumber`. We deliberately do not request `kCGWindowName` (titles) to avoid the Screen Recording prompt.
- `desktopCapturer` source IDs are parsed for the CGWindowID (`window:NUMBER:0` on macOS); `activeSourceWindowId` is stashed in main when the picker confirms.
- `OCRSource` emits a structured `frame-ocr` event (OcrResult + region) on every successful recognize. Main's `bindSource` subscribes and calls `emitRealWindowHoverZones`, which queries the window-info sidecar for live bounds and runs the same coord transform as `emitTestVnHoverZones`.
- `HoverProtoLayer` in renderer absolute-positions invisible (or debug-bordered) divs at supplied screen-DIP coords. Hover triggers existing `dictLookupWithDeinflect` IPC; popup attaches to the cursor.
- Hover mode is **default on**. `Cmd+Shift+H` toggles; `Cmd+Shift+D` toggles visible debug rectangles. `?hover=off` disables the default.
- Source picker auto-confirms a full-frame region as soon as the first bitmap arrives. `RegionSelector.tsx` stays in-file as a future "atypical layouts" escape hatch (`setStep('region')`); not reachable from the current UI.

**Material findings (read before iterating):**

1. **Apple Vision `.fast` is unusable for Japanese.** DTS thread [#131510](https://developer.apple.com/forums/thread/131510) documents that `.fast` returns true per-character bboxes via `boundingBox(for:)`, but in practice it returns *zero observations* on Japanese text. We use `.accurate` and synthesize per-character rects on the Node side by dividing the line bbox horizontally by character count (`synthesizeCharRects` in `src/main/ocr/apple-vision.ts`). CJK fonts are near-monospace so this is tight enough for hover hit zones; narrow chars like 、 ょ get a slightly oversized zone.
2. **OCRSource fires once for static windows.** The stabilizer needs a >20-bit hash change to fire again; static text (TextEdit, paused VN) gets exactly one `frame-ocr` emit. `HoverZonePayload` therefore lives at App-level state (not inside `HoverProtoLayer`) so it survives hover-mode toggle remounts. Better long-term fix: have the renderer signal "I just toggled on" and have main re-emit the cached payload — see open items.
3. **Coordinate transform.** Cropped-image-px → full-window-px (+region offset) → window DIPs (÷scaleFactor) → screen DIPs (+capture origin) → overlay-CSS px (−overlay origin). For the Test VN path "capture origin" is `getContentBounds()` (excludes title bar — matches what `webContents.capturePage()` returns); for the real-window path it's the CG window's `kCGWindowBounds` (full window incl. chrome — matches what SCK's `getDisplayMedia` returns).
4. **Overlay must be `focusable: false`** so it doesn't steal focus from the captured window — but that means renderer-side `keydown` listeners never fire. Hotkeys go through `globalShortcut` in main and forward via IPC.

**What's left for Ship 2.5 → done-done:**

- [ ] **Real-VN dogfood.** Same item from original Ship 2; now means "open a real Mac-native Japanese VN, point the picker at it, verify hover zones track the textbox as lines advance." Narcissu is gone (32-bit, blocked at Catalina). itch.io Ren'Py JP titles are the most accessible path.
- [ ] **Decouple zone re-emit from OCR fire cadence.** Static-window finding above is mitigated by App-level caching but the proper fix is a renderer→main "send latest" ping on hover-mode-on so we don't depend on stabilizer-fire timing.
- [ ] **Multi-display / DPI scaling.** Untested across displays with different scale factors. The transform uses `screen.getDisplayMatching(bounds).scaleFactor` per emit, which should handle moves between displays, but unverified.
- [ ] **Vertical text (tategaki).** Vision needs pre-rotated input; not handled. Many VNs use horizontal but vertical is a real gap.
- [ ] **Windows parity.** Win sidecar still emits text-only OCR; for hover mode it needs (a) per-line bbox extension (Windows.Media.Ocr's `OcrLine.BoundingRect` is per-pseudo-word and line-grouped) and (b) a window-info equivalent — `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` via koffi, parsing HWND from `window:HWND:0` source IDs. `GetWindowRect` includes invisible DWM resize borders so don't use that.
- [ ] **Compile the existing Win OCR sidecar.** Source at `vendor/windows-media-ocr/`. Need a Win box or `dotnet publish` from Mac with .NET 9 SDK. Without this, even the text-only Win path is Mac-only.

**Definition of done:** install → launch → click "select source" → pick a real VN window → hover over textbox text → popup. Mac and Win both validated.

### Ship 2.6 — Cross-platform manga-OCR via ONNX — **PLANNED** (2026-05-09)

Empirical follow-up to Ship 2.5 dogfood: Apple Vision `.accurate` reliably substitutes rare kanji with similar-looking common ones because of language-model frequency bias. Confirmed against 「唵・摩利支曳婆婆訶」 from a Kajiri Kamui Kagura screenshot — Vision returns 俺 ("I/me", common) in place of 唵 ("om", rare); they share the right component (奄), differ only in the left radical (亻 vs 口), and 俺 outweighs 唵 in any training corpus by ~5 orders of magnitude. Pre-OCR scaling (tested 0.7×, 1×, 2×) and pre-rotation (vertical mode) don't change the substitution rate; they're diagnostics, not fixes. Manga-OCR is the documented fix — TrOCR-class model fine-tuned on Japanese fictional content, exactly the corpus where rare kanji appear.

**Decision: ONNX-in-Node, not Python sidecar.** Python on Windows is hostile (no system Python; PyInstaller bundle adds ~100MB plus signing pain). `onnxruntime-node` ships prebuilt native binaries for Mac arm64+x64 and Win x64 uniformly; no Python in the install.

**Architecture: hybrid Vision-detect + manga-OCR-recognize.** Manga-OCR is recognition-only — given a cropped line image, returns the text; doesn't produce bboxes, doesn't detect arbitrary scenes. Vision is good at *detection* (finding line bboxes), bad at *recognition* of rare kanji. Manga-OCR is the reverse. Pipeline: Vision finds bboxes → for each line, crop the captured PNG → send to manga-OCR → splice the better text back into the OcrResult before tokenize/zone-build.

**Plan + handoff details:** see `~/.claude/plans/manga-ocr-onnx.md`. Includes the validation gate (a standalone test that confirms manga-OCR actually fixes 唵→俺 before any architectural integration), stack picks (`@huggingface/transformers` over raw `onnxruntime-node` to avoid hand-rolling the ViT preprocessing/tokenizer), and interaction notes for the `experiment/vertical-and-upscale` branch.

**Branch state at plan-write time (2026-05-09):**
- `main` is at `07c3065` (Ship 2.5 done; clean working tree).
- `experiment/vertical-and-upscale` (`69e8c24`) holds Cmd+Shift+J vertical pre-rotation and Cmd+Shift+U scale-to-1800px-target plus a couple of bug fixes (hash-on-output-canvas, initial-state propagation, OcrResult dims). Both toggles confirmed-not-fixing the substitution problem; the bug fixes are independently good and worth cherry-picking.

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

- **Real-VN ScreenCaptureKit behavior** (Ship 2.5 closeout). Need a real VN session to confirm the SCK-throttling-when-idle pathology doesn't bite real animated VNs. If it does, the next layer is a Swift sidecar talking to `SCStream` directly. See "Dogfood notes" above.
- **Audio capture for Ship 3** is genuinely hard cross-platform; may need a separate research spike before Ship 3 starts. Worst case: defer to "user records via OBS, GSM-style file watching" — but that loses the all-in-one promise.
- **Dictionary distribution**: bundled vs. downloaded on first run. Lean toward downloaded (~12MB gzipped JMdict) so installer stays slim; Ship 5 question.
- **Multi-game profile support**: per-game settings (region for OCR, dict overrides, mining deck). Region persistence is in for Ship 2; the rest waits for Ship 4 settings UI.
- **Color/theme**: not yet designed. Default to dark, glassy, low-contrast against game; expose CSS injection for users who want to restyle.
- **OCR text-effect handling**: typewriter rollouts, fade-ins, partial reveals — current 350ms stabilization handles the test fixture. Real VNs may need per-engine debounce tuning.
- **manga-ocr packaging** (deferred past Ship 2.5): 400MB ONNX model is too large to bundle in the installer. Download-on-first-use when the user opts into heavy-mode OCR. Lower priority now that Apple Vision `.accurate` is producing usable results on hover-tested content.

## Known platform limits

- **Windows exclusive fullscreen** breaks the overlay AND breaks `Windows.Graphics.Capture` for Ship 2. Most modern engines (KiriKiri, Ren'Py, Unity) use borderless windowed. Document the limit; direct users to switch to windowed mode if needed.
- **Hardware-accelerated transparency bug #40515** affects some GPU drivers. Expose `disableHardwareAcceleration` toggle in settings.
- **macOS Tahoe Electron lag reports** (mjtsai 2025-09) — load-test on Tahoe before Ship 2 ships.
- **OCR quality cliff** for ornamented/calligraphic VNs (Kajiri Kamui Kagura tier — vertical text, decorative fonts, low-contrast scenes). Apple Vision and OneOCR fail; manga-ocr does meaningfully better but still struggles. These titles will always read better via Textractor hooks; that's why hooks remain available in Ship 4 polish phase.

## Picking up where we left off (handoff for the next session)

If you're a fresh Claude Code session opening this repo:

1. **Ships 1, 2, and 2.5 are merged to `main`.** Hover-on-VN-text consumer is the live default. All commits at `https://github.com/jrgmadrid/yomiko` (private). Local working dir clean.
2. **Run it:** `npm install && npm run build:dict && npm run dev`. The Mac sidecars (Vision OCR + window-info) autobuild on postinstall via `npm run build:sidecar:mac`. Swift toolchain required. Win OCR sidecar source is at `vendor/windows-media-ocr/` but uncompiled.
3. **The test rig:** in DevTools console of the overlay window, `window.vnr.openTestVN()` opens a fake VN with eight Japanese lines (→ / Space to advance). Pick it in the source picker — picker auto-closes on first frame, no region drag. Hover over textbox text → popup. Cmd+Shift+D shows debug rects. The Test VN path uses `webContents.capturePage()` (see "Dogfood notes #1") because SCK throttles non-interacted owned BrowserWindows.
4. **For real windows:** pick anything (Safari with JP Wikipedia, Notes.app with JP text, etc.). Frames flow through `getDisplayMedia` → OCRSource → `frame-ocr` → `emitRealWindowHoverZones`. Window position comes from the macos-window-info sidecar (`CGWindowListCopyWindowInfo`).
5. **The actually-open tasks** (in order): real Mac-native VN dogfood (see "What's left for Ship 2.5"); decouple zone re-emit from stabilizer-fire cadence; vertical text; Windows parity (sidecar bbox extension + `DwmGetWindowAttribute` via koffi).
6. **Don't touch the architecture.** Specifically: (a) don't reintroduce the bottom-bar overlay or standalone popup BrowserWindow refactor (Dogfood note #2); (b) don't switch the Vision sidecar to `.fast` for per-character bboxes (Ship 2.5 finding #1: zero observations on Japanese); (c) don't move the `onHoverZones` subscription back into `HoverProtoLayer` (Ship 2.5 finding #2: payload must survive hover-mode remounts).
7. **Order of operations going forward:** finish Ship 2.5 (real-VN dogfood + Windows parity) → Ship 3 (Anki sentence mining) → Ship 4 (settings/polish + Textractor toggle) → Ship 5 (distribution). Manga-ocr stays deferred unless Apple Vision degrades on a real VN.

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
