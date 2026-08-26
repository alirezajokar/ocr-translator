# OCR Translator

A background utility for Ubuntu/GNOME: press a keyboard shortcut, drag a box around any
text on screen, and get the extracted text instantly with an optional one-click
translation. Runs quietly in the background — no window, no dock icon, no browser tab.

> Built for Ubuntu 26.04 / GNOME Shell (Wayland) specifically. It relies on GNOME's own
> D-Bus and `gsettings` mechanisms, so it won't work as-is on KDE, XFCE, or other distros.

## Requirements

- Ubuntu with GNOME Shell, Wayland session
- [Node.js](https://nodejs.org/) (tested on v24)

No system OCR package is required — OCR runs entirely in-process via
[tesseract.js](https://github.com/naptha/tesseract.js) (WASM), not a system `tesseract`
binary.

## Install

```bash
npm install
```

Electron's Linux sandbox helper needs root ownership, which a fresh `npm install` resets —
run this once after installing (and again after any `npm install` that touches the
`electron` package):

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Run

```bash
npm start
```

This starts the background daemon. The first capture in a new language pair needs network
access once (to fetch OCR language data); after that everything runs offline.

**To have it start automatically at login**, an autostart entry is already set up at
`~/.config/autostart/ocr-translator.desktop` pointing at `bin/daemon.sh`.

## Using it

| Action | How |
|---|---|
| Capture & Translate | Press the global shortcut (default `Ctrl+Alt+O`, changeable in Settings) |
| Open Settings | Tray icon menu (if visible on your system — see note below) |
| Quit | "Quit OCR Translator" button inside Settings |

Pressing the shortcut takes over the screen for you to drag a selection box (GNOME's own
screenshot picker) — no separate app window opens first. After you finish the selection, a
small popup shows the extracted text with a Copy button, and a "Translate" button you can
click if/when you actually want a translation (it isn't automatic, so plain OCR stays fast).

### Settings

Opened from the tray menu. Configure:

- **Base URL / API Key / Model** — any OpenAI-compatible chat completions endpoint
- **Target language** — what to translate into
- **OCR languages** — tesseract language codes, e.g. `eng+fas` for English + Persian
- **Global shortcut** — click the button, then press your desired key combo (must include
  Ctrl, Alt, or Super)

The API key is stored in a local plaintext file (`~/.config/ocr-translator/settings.json`,
owner-only permissions) — not encrypted. Don't share this file.

### Known limitation: the tray icon

On some GNOME/Electron version combinations, the tray icon doesn't render (a GNOME
extension / Electron interaction bug, not specific to this app). If you don't see it, you
can still reach Settings by running:

```bash
bin/trigger.sh settings
```

The global shortcut for Capture & Translate works independently of the tray either way.

## Where things are stored

| What | Where |
|---|---|
| Settings (API key, model, shortcut, etc.) | `~/.config/ocr-translator/settings.json` |
| Cached OCR language data | `~/.config/ocr-translator/tessdata-cache/` |
| Captured screenshots | `~/Pictures/Screenshots/` (GNOME's own screenshot location) |

## Status

Local/personal-use build, not yet packaged for distribution (no installer, no
auto-update). See [AGENTS.md](AGENTS.md) for architecture notes and known quirks if you're
picking this project back up (with or without AI assistance).
