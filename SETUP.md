# Setup

One-time steps to run yomiko against an actual visual novel.

## On the developer machine

```sh
npm install
npm run build:dict   # downloads jmdict-simplified, builds resources/dict/jmdict.db (~150MB, gitignored)
npm run dev          # launches the overlay
```

The kuromoji tokenizer dictionary ships with the npm package — no separate download.

## Get text out of a VN

The overlay listens on `ws://127.0.0.1:6677`. Anything that posts plain-text lines to that socket will appear in the overlay; the canonical source is Textractor.

### Mac (via Whisky / CrossOver)

1. Install Whisky from <https://getwhisky.app> or CrossOver.
2. Inside the Wine prefix, install **Textractor** from <https://github.com/Artikash/Textractor/releases>.
3. Drop **kuroahna's WebSocket extension** (`textractor_websocket_x86.dll`) into `Textractor/x86/`. Build/download from <https://github.com/kuroahna/textractor_websocket>.
4. Open the VN through Textractor. In the *Extensions* dialog, change the file filter from `*.xdll` to `*.dll` and add the WebSocket DLL.
5. macOS will prompt to allow the Wine binary through the firewall on first WS bind — allow it.

> The WS server starts lazily — only after Textractor selects a non-Clipboard thread and that thread emits a line. The overlay status will sit at "reconnecting" until then.

### Windows

Same as above without the Wine layer. Install Textractor natively, drop the DLL into `x86/`, configure the extension, run.

## Verifying without Textractor

In the overlay's DevTools (toggle with `F12` if you've enabled the optimizer shortcuts):

```js
window.vnr.devPaste('猫が窓辺で眠っている。')
```

The line should appear in the overlay with hover-able tokens.

## Updating JMdict

```sh
rm resources/dict/jmdict.db
npm run build:dict
```

`jmdict-simplified` ships weekly; rebuild whenever you want fresh data.
