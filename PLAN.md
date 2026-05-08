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

### Ship 2 — One-click OCR + window capture (was Ship 4) — **SUBSTANTIALLY DONE** ✓ (2026-05-08)

Pipeline + UX are built and verified end-to-end on the test rig. **Real-VN verification is the open item** — see "What's left for Ship 2" below.

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

### What's left for Ship 2

- [ ] **Real-VN dogfood.** Open an actual VN (not the test fixture), point the picker at it, verify the OCR pipeline catches dialogue updates as the VN advances. Real VNs render continuously via animations, so they should not trip the SCK throttling that bites the test fixture (see "Dogfood notes" below). If they do trip it, escalate to a Swift sidecar that calls ScreenCaptureKit directly with explicit `SCStreamConfiguration` settings.
- [ ] **Compile the Win sidecar** on a Win box (or via `dotnet publish` from Mac after installing .NET 9 SDK). Source is at `vendor/windows-media-ocr/`. Without this, Ship 2 is Mac-only.

**Definition of done:** install, launch, click "select window," drag textbox, read an actual VN. Zero terminal commands required after install. Mac and Win both validated.

### Dogfood notes (Ship 2)

These are the load-bearing lessons from the 2026-05-08 dogfood session — read before touching Ship 2 internals or planning Ship 2.5+:

**1. macOS ScreenCaptureKit throttles frame delivery for non-interacted windows.** When a captured target window's content updates (DOM change, repaint) without direct mouse interaction *inside that window*, SCK stops delivering fresh frames to `getDisplayMedia` consumers. Frames keep arriving — they're just stale. Highlighting text in the source breaks the spell because mouse-drag is "interaction." This is a real macOS Tahoe behavior, not an Electron bug.

**Workaround in tree:** for our owned Test VN BrowserWindow, we bypass `getDisplayMedia` entirely and poll `webContents.capturePage()` from main at 5fps. This pulls straight from Chromium's compositor for windows we own. See `pollTestVnFrame` in `src/main/index.ts`. **Not applicable to third-party VNs** — `capturePage` only works on BrowserWindows we control.

**Hypothesis for real VNs:** they render constantly via animations / particles / sprite blinking, so they never go idle long enough for SCK to throttle. Untested. If real VNs DO trip the throttle, the right fix is a Swift sidecar talking to `SCStream` directly with our chosen `SCStreamConfiguration` (explicit `minimumFrameInterval`, etc.) instead of going through Electron's `getDisplayMedia`. The sidecar pattern is already established for OCR.

**2. The architectural-refactor detour was wrong.** During the same dogfood session a sub-agent diagnosed the staleness as Chromium's `NativeWindowOcclusionTracker` pausing the source's compositor because our full-screen transparent overlay covered it. We restructured the overlay to a bottom strip + a separate popup BrowserWindow accordingly. The bug persisted — diagnosis was wrong (or at most partial). After identifying the SCK throttling cause, we reverted to the original full-screen overlay + inline popup architecture. **Lesson: when the agent's first diagnosis maps to a 200-line restructure, get the actual fix to validate before committing.**

**3. Hash sensitivity matters more than expected.** Initial dHash at 64 bits over a 9×8 grid produced Hamming deltas of 2-7 bits between distinct VN lines (background averaged out the text). Bumped to 256 bits (16×16) — still ≤ 7 bits. Switched from dHash (compares adjacent pixels) to aHash (compares each cell to global mean). aHash captures *where* the bright pixels are, which is what changes between VN lines. Distinct lines now produce 30-80 bit deltas. Stabilizer threshold is 20 bits over 256.

**4. Layout caveat.** The overlay bar grows upward as content gets tall (long wrapping dialogue). Without `max-h-[85vh]` + `overflow-y-auto`, the bar's header (status pip + select-source button) slides off the top of the screen. Same pattern in the picker modal. Fixed in `c805713`.

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

- **Real-VN ScreenCaptureKit behavior** (Ship 2 closeout). Need a real VN session to confirm the SCK-throttling-when-idle pathology is test-fixture-specific. If it's not, the next layer is a Swift sidecar talking to `SCStream` directly. See "Dogfood notes" above.
- **Audio capture for Ship 3** is genuinely hard cross-platform; may need a separate research spike before Ship 3 starts. Worst case: defer to "user records via OBS, GSM-style file watching" — but that loses the all-in-one promise.
- **Dictionary distribution**: bundled vs. downloaded on first run. Lean toward downloaded (~12MB gzipped JMdict) so installer stays slim; Ship 5 question.
- **Multi-game profile support**: per-game settings (region for OCR, dict overrides, mining deck). Region persistence is in for Ship 2; the rest waits for Ship 4 settings UI.
- **Color/theme**: not yet designed. Default to dark, glassy, low-contrast against game; expose CSS injection for users who want to restyle.
- **OCR text-effect handling**: typewriter rollouts, fade-ins, partial reveals — current 350ms stabilization handles the test fixture. Real VNs may need per-engine debounce tuning.
- **manga-ocr packaging** (Ship 2.5): 400MB ONNX model is too large to bundle in the installer. Download-on-first-use when the user opts into heavy-mode OCR.

## Known platform limits

- **Windows exclusive fullscreen** breaks the overlay AND breaks `Windows.Graphics.Capture` for Ship 2. Most modern engines (KiriKiri, Ren'Py, Unity) use borderless windowed. Document the limit; direct users to switch to windowed mode if needed.
- **Hardware-accelerated transparency bug #40515** affects some GPU drivers. Expose `disableHardwareAcceleration` toggle in settings.
- **macOS Tahoe Electron lag reports** (mjtsai 2025-09) — load-test on Tahoe before Ship 2 ships.
- **OCR quality cliff** for ornamented/calligraphic VNs (Kajiri Kamui Kagura tier — vertical text, decorative fonts, low-contrast scenes). Apple Vision and OneOCR fail; manga-ocr does meaningfully better but still struggles. These titles will always read better via Textractor hooks; that's why hooks remain available in Ship 4 polish phase.

## Picking up where we left off (handoff for the next session)

If you're a fresh Claude Code session opening this repo:

1. **Ship 1 + 2 are done as code.** All commits are on `main` at `https://github.com/jrgmadrid/yomiko` (private). Local working dir is clean.
2. **Run it:** `npm install && npm run build:dict && npm run dev`. The Mac sidecar autobuilds on postinstall (Swift toolchain required). Win sidecar source exists in `vendor/windows-media-ocr/` but is uncompiled — needs `dotnet publish`.
3. **The test rig:** in DevTools console, `window.vnr.openTestVN()` opens a fake VN with eight Japanese lines you can advance with → / Space. Pick it in the source picker, drag a region over the textbox, advance lines — overlay should update in real time. This works because of the `capturePage` poll path in `src/main/index.ts` (see "Dogfood notes #1").
4. **The actually-open task:** dogfood Ship 2 against a real VN. If it works, mark Ship 2 done-done and move to Ship 3 (Anki sentence mining). If real-VN frames are stale just like the test fixture was, escalate to a ScreenCaptureKit Swift sidecar.
5. **Don't touch the architecture.** Specifically don't reintroduce the bottom-bar overlay or the standalone popup BrowserWindow refactor — that's the failed detour from "Dogfood notes #2." The full-screen overlay + inline popup is correct.
6. **Order of operations going forward:** finish Ship 2 (real-VN check + Win sidecar build) → Ship 2.5 (manga-ocr opt-in) → Ship 3 (Anki) → Ship 4 (settings/polish + Textractor toggle) → Ship 5 (distribution).

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
