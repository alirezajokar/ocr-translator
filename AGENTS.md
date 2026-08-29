# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo.
Humans: see [README.md](README.md) instead — this file is deliberately terser and more
mechanical, and assumes you already know what the app does.

## Project overview

A tray/keyboard-triggered Electron app for Ubuntu/GNOME (Wayland): the user presses a
global shortcut, drags a selection box around text on screen, the app OCRs it locally
(tesseract.js), and shows the result with an on-demand "Translate" button (calls an
OpenAI-compatible chat completions endpoint). Runs as a background daemon, not a normal
windowed app — see **Architecture** below before changing control flow.

No build step. Plain HTML/CSS/JS, loaded directly via `BrowserWindow.loadFile()`. No
React/Vue, no bundler, no TypeScript, no Tailwind. Keep it that way — don't introduce one
of these to "fix" something; solve it in plain JS/CSS.

## Setup commands

```bash
npm install
npm start          # foreground, for interactive testing — see the sandbox gotcha below
npm run dist       # builds dist/*.AppImage and dist/*.deb via electron-builder (local testing only —
                    # real release artifacts come from .github/workflows/release.yml on a pushed tag)
```

**chrome-sandbox gotcha (will bite you immediately after `npm install`)**: Electron's Linux
sandbox helper binary must be owned by root with mode 4755, and a *fresh* `npm install`
resets it to normal user-owned permissions, which makes every launch abort instantly with
`FATAL: The SUID sandbox helper binary was found, but is not configured correctly`. Fix
after every `npm install` that touches the `electron` package:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

There is no error-message-free way to detect this from inside the app (it crashes before
any of our JS runs) — if a shortcut or `npm start` silently does nothing, check this first.

## Architecture (read before changing control flow)

```
main.js               Main process: tray (best-effort, see Known issues), popup/settings
                       BrowserWindows, capture-flow orchestration, IPC handlers, single-
                       instance-lock + second-instance forwarding (see below)
preload.js             contextBridge — the ONLY surface renderers can call. Every function
                       is a narrow, specific verb. Never expose raw ipcRenderer/fs/etc.
lib/
  gnomeScreenshot.js    Interactive screen capture — MUST go through the xdg-desktop-portal
                        Screenshot request (`interactive: true`), NOT org.gnome.Shell.
                        Screenshot directly. See "Known issues" below for why.
  gnomeShortcuts.js     Registers the global capture shortcut as a GNOME custom keybinding
                        via `gsettings` (see "Known issues" — Electron's globalShortcut is
                        not an option here).
  ocr.js                tesseract.js wrapper. Keeps ONE persistent worker alive across
                        captures (re-creating one per capture was the original perf bug —
                        don't regress this). PSM is pinned to SINGLE_BLOCK (see inline
                        comment) — don't revert to AUTO without a reason.
  translate.js          OpenAI-compatible chat/completions call via the official `openai`
                        npm package (not a hand-rolled `fetch` call — see "Known issues").
  settingsStore.js      Plain JSON file under `app.getPath('userData')`. Validates on the
                        main-process side always — never trust renderer input just because
                        it came from our own settings form.
bin/
  trigger.sh <action>   What the GNOME shortcut actually runs: capture | settings | quit.
                        Relies on the single-instance-lock/second-instance pattern below.
  daemon.sh             Flagless launch used by the autostart .desktop entry — idle start.
renderer/
  popup/                Frameless always-on-top result window (capture/OCR/translate UI).
  settings/             Settings window.
  shared/tokens.css      Shared design tokens (colors, radii, shadows) — both windows
                        `<link>` this before their own stylesheet.
```

**Single-instance / second-instance pattern**: the daemon holds Electron's single-instance
lock. `bin/trigger.sh capture|settings|quit` launches a throwaway `electron .
--<action>` process; if the daemon is already running, that throwaway process just
forwards `<action>` to it via the `second-instance` event and exits — it never opens its
own window. If nothing was running yet, that same launch *becomes* the daemon and the
`initialAction` check in `app.whenReady()` runs the action directly. Keep both paths (the
`second-instance` handler and the `whenReady` `initialAction` check in `main.js`) in sync
if you add a new action.

## Known issues / non-obvious constraints (do not "fix" these by reverting)

- **No system tray icon on some GNOME/Electron combos**: confirmed root cause via
  `journalctl` — GNOME's `ubuntu-appindicators` extension logs `NameHasNoOwner` when
  Electron tries to register the StatusNotifierItem (a libayatana-appindicator /
  Electron 44 race, not our bug). The tray is kept as best-effort UI only — **never make
  the app's core activation depend on the tray rendering**. The keyboard shortcut is the
  real activation path.
- **Screenshot capture must use the xdg-desktop-portal, not `org.gnome.Shell.Screenshot`
  directly.** The latter looked like the better option early on (no permission dialog) and
  even worked briefly in testing, but GNOME denies it (`AccessDenied: SelectArea is not
  allowed`) as a matter of policy on current GNOME versions. `lib/gnomeScreenshot.js` uses
  `org.freedesktop.portal.Screenshot` with `interactive: true`, driven via `dbus-next`
  (request/response over signals — not something you can drive with a one-shot `gdbus
  call`, which is why this file doesn't just shell out like the rest of the app does).
- **Global shortcuts cannot use Electron's `globalShortcut` module** — it's X11-only in
  practice and this app targets Wayland/GNOME. Activation goes through a GNOME custom
  keybinding (`gsettings`) running the self-invocation command from `selfInvokeCommand()`
  (see above), managed by `lib/gnomeShortcuts.js`. If you ever add a second global action,
  add a new named slot there (`ocrtranslator-*`) rather than reusing `custom0`/
  `custom1`-style generic slots — those collide with anything else on the system using the
  same shared `custom-keybindings` list.
- **`gsettings set ... command '<value>'` GVariant-parses a value starting with a quote
  character** instead of treating it as a literal string — a real bug hit while building
  this: the self-invocation command is itself a shell command line wrapping each argument
  in single quotes, and passing that bare made `gsettings` choke trying (and failing) to
  parse it as GVariant syntax. Fix in `lib/gnomeShortcuts.js`: `JSON.stringify()` the value
  before passing it — its double-quoted output is close enough to GVariant's own
  double-quoted string syntax to pass through as one literal.
- **tesseract.js's Node cache adapter is a bare `fs.writeFile`** — it does not create its
  own directory, and a failed write is caught *inside* tesseract.js and only logged to its
  own internal logger, never thrown back to us. `lib/ocr.js`'s `cacheDir()` explicitly
  `mkdirSync`s before returning the path. Without this, language data silently
  re-downloads from the CDN on every worker creation instead of ever landing on disk.
- **OCR picks up decorative icons as stray characters** — confirmed with a real capture: a
  diamond/logo icon next to real text got read as the character `"<"` at confidence 67,
  while the real text alongside it scored 95-96. A single global confidence threshold can't
  separate those (67 is a legitimate score for real-but-imperfect text too). `lib/ocr.js`'s
  `extractConfidentText()` instead applies a *much* stricter confidence ceiling, but only to
  "words" that are short (≤2 chars) and contain no letter/digit at all — i.e. could
  plausibly be a misread icon/symbol. Real words always contain a letter/digit, so this
  can't touch them regardless of their confidence. If false positives/negatives show up
  with real screenshots, tune `SUSPICIOUS_SYMBOL_CONFIDENCE_CEILING`/`_MAX_LEN` there rather
  than the global `MIN_WORD_CONFIDENCE` floor.
- **Popup IPC race**: don't call `sendUpdate()` synchronously right after creating a new
  popup `BrowserWindow` — the renderer hasn't loaded `popup.js` yet and the message is
  lost, leaving the UI stuck on its static placeholder. `ensurePopupWindow()` buffers the
  first update until `did-finish-load` fires; keep using `sendUpdate()` (never
  `popupWindow.webContents.send(...)` directly) so that buffering stays in effect.
- **Use the official `openai` SDK for the translation call, not a hand-rolled `fetch`** —
  this was a real production bug, not just a style preference: the original hand-rolled
  client never sent `stream` in the request body, and at least one real OpenAI-compatible
  provider defaults to streaming (SSE) when it's omitted rather than defaulting to `false`
  per the OpenAI spec, which broke translation against that provider. `lib/translate.js`
  now sends `stream: false` explicitly via `client.chat.completions.create(...)`. If you
  ever touch this file, keep that explicit and don't go back to a manual HTTP client for
  an OpenAI-compatible API without a real reason.
- **Translation is on-demand, not automatic** — this was a deliberate change from the
  original design (auto-translate after OCR). OCR result shows immediately; a "Translate"
  button in the popup calls the separate `translate:start` IPC handler. Don't reintroduce
  automatic translation after OCR without being asked.
- **Packaging-safe self-invocation and asset paths**: the GNOME shortcut command and the
  login-autostart `.desktop` entry are NOT hardcoded to `bin/trigger.sh`/`bin/daemon.sh` —
  those two scripts are dev-convenience only now. `main.js`'s `selfInvokeCommand(action)`
  computes the right relaunch command from `process.execPath` (+ `app.getAppPath()` only
  when unpackaged), so the same code works whether running from source or from an
  installed `.deb`/AppImage. Similarly, `assetPath(...)` resolves icon files to a path
  under `resources/app.asar.unpacked/` when packaged (see `"build.asarUnpack"` in
  `package.json`) instead of a virtual `app.asar` path — required because GNOME reading
  the autostart `.desktop` file's `Icon=` has no idea what an asar archive is, unlike
  Electron's own APIs which are asar-transparent. If you add a new icon reference used by
  anything outside this process, route it through `assetPath()`, not `__dirname` directly.
- **electron-builder's `.deb` target already solves the chrome-sandbox permission problem
  correctly** for real installs — its generated `postinst` script checks for unprivileged
  user-namespace support (`unshare --user true`) and only falls back to the root-owned
  `chmod 4755` when the kernel needs it. The manual `chown root:root && chmod 4755` dance
  described above is a *source/dev-mode-only* workaround; don't "fix" the packaged build
  by copying that logic in — it's unnecessary there and already handled.

## Code style

- No comments except where the WHY is genuinely non-obvious (a workaround, a hidden
  constraint, a bug reference) — this file's "Known issues" section is exactly that kind
  of thing; most of the codebase should not read like this.
- IPC surface (`preload.js`) stays a small set of specific named functions
  (`triggerCapture`, `getSettings`, `saveSettings`, `translateNow`, `copyToClipboard`,
  `closePopup`, `quitApp`, `onCaptureUpdate`) — never widen it to a generic passthrough.
- Renderer `webPreferences` stay `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` on every `BrowserWindow`. No `remote` module.
- Renderer HTML has a strict CSP (`default-src 'none'; script-src 'self'; style-src
  'self'; img-src 'self'`) — no inline `<script>`, no `onclick="..."`, no inline
  `style="..."`, no remote fonts/CDNs/images. All JS goes in the linked `.js` file via
  `addEventListener`; all CSS in the linked `.css` file; icons as inline `<svg>` markup.
- Settings validation lives in `lib/settingsStore.js` and runs on the main-process side of
  every save — the renderer is not a trust boundary.
- Don't bolt on fake "encryption" for the plaintext-stored API key in `settings.json`. It's
  a known, deliberate MVP limitation (see the comment at the top of `settingsStore.js`). A
  real fix is OS keychain integration (Electron's `safeStorage` or libsecret) — a distinct,
  larger task, not something to half-do inline.

## Testing / verification

There is no automated test suite yet. Verify changes like this:

```bash
node --check <file>.js               # every JS file you touch, before running the app
```

Then restart the daemon and re-test the real flow (there's no way to unit-test the GNOME
D-Bus / gsettings integration paths — they need a live session):

```bash
bin/trigger.sh quit    # stop the running daemon, if any
npm start &            # restart it (or: npx electron . &)
```

Then exercise the actual shortcut (default `Ctrl+Shift+O` unless the user changed it in
Settings) and watch console output — `lib/gnomeScreenshot.js`, `lib/ocr.js`, and
`main.js`'s capture flow all log their steps (`[gnomeScreenshot]`, `[ocr]`, `[main]`
prefixes) specifically so failures are diagnosable from the terminal instead of needing a
screenshot of the UI.

## Security considerations

- `settings.json` holds a plaintext API key by design (see above) — written with mode
  `0600`. Don't log its contents; don't add telemetry that would transmit it.
- Screenshot files land in the user's own `~/Pictures/Screenshots/` (the portal's choice,
  not ours) — the app never writes captured images anywhere else, and never uploads the
  raw image anywhere; only OCR'd text is sent to the translation endpoint, and only when
  the user explicitly clicks Translate.
- Keep `contextIsolation`/`sandbox` on and the CSP intact (see Code style) — this is an
  unsandboxed-by-the-OS desktop app (needed for the D-Bus/gsettings calls), so the
  renderer sandbox is the remaining layer worth not weakening.
