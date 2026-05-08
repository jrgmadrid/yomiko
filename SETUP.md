# Setup

yomiko's default flow is **window capture + OCR** — pick the VN's
window, drag a rectangle over the textbox, read. No Wine, no DLL config.

## Quick start

```sh
git clone git@github.com:jrgmadrid/yomiko.git
cd yomiko
npm install               # postinstall builds the platform sidecar
npm run build:dict        # ~1min — fetches jmdict-simplified, builds SQLite
npm run dev
```

In the running app:

1. Click **select source** in the bar at the bottom of your screen.
2. Pick the VN's window from the thumbnail grid.
3. Drag a rectangle over the dialogue textbox in the live preview.
4. Click **Confirm region**.
5. Advance VN dialog — text appears in the overlay with hover-able
   word definitions.

The first time yomiko captures a window, macOS will prompt for
**Screen Recording** permission — grant it in System Settings → Privacy
& Security → Screen Recording, then quit and relaunch the app. (TCC
permission only refreshes on app restart.)

The region is remembered per window name, so reopening the same VN
picks up the saved region automatically.

## Sidecar build details

yomiko spawns a tiny per-platform OCR sidecar to talk to the OS
text-recognition APIs:

- **macOS** → Apple Vision (`VNRecognizeTextRequest`) via a Swift CLI
  in `vendor/macos-vision-ocr/`. Requires Xcode command-line tools
  (Swift 5.9+). Built with `npm run build:sidecar:mac`.
- **Windows** → Windows.Media.Ocr via a .NET 9 console app in
  `vendor/windows-media-ocr/`. Requires .NET 9 SDK + Win10 19041 SDK.
  Built with `npm run build:sidecar:win` (PowerShell). Win10 2004+ /
  Win11 only; needs the Japanese language pack installed (Settings →
  Time & Language → Language → Add → Japanese).

Both sidecars are gitignored binaries that land in `resources/bin/`.
The `build:sidecars` script auto-picks the right target for the
current platform.

## OCR fails on this title

Some VNs have ornamented or calligraphic typography that current OCR
backends can't read reliably (Type-Moon-flavored eroge, Kajiri Kamui
Kagura tier). For those titles you'll want **Textractor with the
WebSocket extension** running alongside the VN — it hooks the engine
directly so it sees the actual text rather than rendered pixels. That
flow is the Ship 4 power-user option.

For now (Ship 2) the only source is OCR. If you want Textractor today,
re-enable `TextractorWSSource` instantiation in `src/main/index.ts`
manually.

## Updating dictionaries

```sh
rm resources/dict/jmdict.db
npm run build:dict
```

`jmdict-simplified` ships weekly; rebuild whenever you want fresher
data.

## Dev tips

- DevTools auto-opens detached on `npm run dev`. The overlay window has
  `focusable: false` so F12 won't reach it — the detached pane is the
  workaround.
- Manual text feed (no VN required):
  `window.vnr.devPaste('猫が窓辺で眠っている。')` in the DevTools console.
- Changing the source: click **change source** in the bar to reopen
  the picker.
