'use strict';

const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  screen,
  ipcMain,
  clipboard,
  nativeImage,
} = require('electron');

const settingsStore = require('./lib/settingsStore');
const gnomeScreenshot = require('./lib/gnomeScreenshot');
const gnomeShortcuts = require('./lib/gnomeShortcuts');
const autostart = require('./lib/autostart');
const ocr = require('./lib/ocr');
const translate = require('./lib/translate');

// Builds a shell command that re-launches THIS exact app (optionally with an action flag),
// working identically whether we're running unpackaged from source (`electron .` — needs
// the app directory as an explicit argument) or from an installed package (`process.
// execPath` alone IS the app; electron-builder bakes the app path into the binary). This
// is what both the GNOME keyboard shortcut and the login-autostart entry actually invoke —
// computed fresh at every startup rather than hardcoded, so packaging/moving/upgrading the
// app doesn't leave either of them pointing at a stale path.
function selfInvokeCommand(action) {
  const parts = [process.execPath];
  if (!app.isPackaged) parts.push(app.getAppPath());
  if (action) parts.push(`--${action}`);
  return parts.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
}

// Resolves a path under assets/ that's guaranteed to be a REAL file on disk, not a virtual
// path inside app.asar — needed for anything read by a process other than this one (the
// autostart .desktop file's Icon=, in particular; GNOME Shell has no idea what an asar
// archive is). electron-builder is configured (see package.json's "build.asarUnpack") to
// keep assets/ unpacked alongside app.asar for exactly this reason. Electron's own APIs
// (Tray, BrowserWindow icon) are asar-transparent so this isn't strictly required for
// those, but using it everywhere keeps every icon reference consistent and packaging-safe.
function assetPath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', ...segments);
  }
  return path.join(__dirname, ...segments);
}

// --- single instance: a second launch just signals the already-running daemon ---
// This is how the GNOME global-shortcut workaround works (see bottom of file): the
// keyboard shortcut "launches" the app with a --capture/--settings/--quit flag, which
// on a normal launch just becomes a no-op second instance that forwards the flag to
// the real running process via this event instead of opening anything new.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

function actionFromArgv(argv) {
  if (argv.includes('--settings')) return 'settings';
  if (argv.includes('--quit')) return 'quit';
  if (argv.includes('--capture')) return 'capture';
  return null;
}

function runAction(action) {
  if (action === 'settings') createSettingsWindow();
  else if (action === 'quit') app.quit();
  else if (action === 'capture') startCaptureFlow();
}

app.on('second-instance', (_event, argv) => {
  const action = actionFromArgv(argv) || 'capture'; // bare relaunch still defaults to capture
  runAction(action);
});

// No default menu bar on any window — this is a small utility app, not a document app.
Menu.setApplicationMenu(null);

// This is a tray-only background app: no window is created at startup, and closing all
// windows (popup/settings) must NOT quit the app the way Electron does by default on
// Linux/Windows. Registering our own (no-op) listener overrides that default.
app.on('window-all-closed', () => {
  // intentionally empty — stay alive in the tray
});

let tray = null;
let popupWindow = null;
let popupReady = false;
let pendingPopupUpdate = null; // only the latest matters — each update fully replaces the view
let settingsWindow = null;
let captureInProgress = false;

const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// sendUpdate() can be called immediately after ensurePopupWindow() creates a brand-new
// window, before its renderer has loaded popup.js and registered the 'capture:update'
// listener — that push would silently vanish and leave the UI stuck on its static
// "Waiting for selection…" placeholder forever. So: buffer until 'did-finish-load' fires
// (see ensurePopupWindow), then flush. Only the latest pending update is kept since each
// one fully replaces the visible view anyway.
function sendUpdate(type, payload) {
  const message = { type, ...payload };
  console.log('[main] popup update:', type, payload);
  if (popupWindow && !popupWindow.isDestroyed() && popupReady) {
    popupWindow.webContents.send('capture:update', message);
  } else {
    pendingPopupUpdate = message;
  }
}

function ensurePopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.show();
    popupWindow.focus();
    return popupWindow;
  }

  const width = 480;
  const height = 400;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const b = display.workArea;

  let x = cursor.x + 16;
  let y = cursor.y + 16;
  if (x + width > b.x + b.width) x = b.x + b.width - width - 8;
  if (y + height > b.y + b.height) y = b.y + b.height - height - 8;
  if (x < b.x) x = b.x + 8;
  if (y < b.y) y = b.y + 8;

  popupWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#15151d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });

  popupReady = false;
  pendingPopupUpdate = null;
  popupWindow.setMenuBarVisibility(false);
  popupWindow.webContents.once('did-finish-load', () => {
    popupReady = true;
    if (pendingPopupUpdate) {
      popupWindow.webContents.send('capture:update', pendingPopupUpdate);
      pendingPopupUpdate = null;
    }
  });
  popupWindow.loadFile(path.join(__dirname, 'renderer', 'popup', 'popup.html'));
  popupWindow.once('ready-to-show', () => popupWindow.show());
  popupWindow.on('closed', () => {
    popupWindow = null;
    popupReady = false;
    pendingPopupUpdate = null;
  });

  return popupWindow;
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 540,
    height: 640,
    resizable: true,
    title: 'OCR Translator — Settings',
    backgroundColor: '#15151d',
    icon: assetPath('assets', 'app-icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });

  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings', 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

async function startCaptureFlow() {
  if (captureInProgress) {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.show();
      popupWindow.focus();
    }
    return;
  }

  captureInProgress = true;
  // Unlike a self-managed temp file, this path is owned by the portal (typically under its
  // own cache dir) — we read it for OCR but don't delete it; its lifecycle isn't ours.
  let capturedFile = null;
  console.log('[main] capture flow started');

  try {
    const settings = settingsStore.getSettings();

    // The portal's interactive Screenshot request takes over the screen for the drag AND
    // captures in one round trip — we deliberately don't show our popup until it resolves
    // (success or cancel).
    capturedFile = await gnomeScreenshot.captureInteractiveArea();
    console.log('[main] captureInteractiveArea resolved:', capturedFile);
    ensurePopupWindow();

    if (!capturedFile) {
      sendUpdate('cancelled', { message: 'Selection cancelled.' });
      return;
    }

    sendUpdate('status', {
      message: 'Running OCR… (first run may take longer while language data downloads)',
    });
    let ocrText;
    try {
      ocrText = await ocr.runOcr(capturedFile, settings.ocrLanguages);
    } catch (err) {
      sendUpdate('error', { message: err.message });
      return;
    }

    ocrText = ocrText ? ocrText.trim() : ocrText; // tesseract output routinely ends in "\n"
    if (!ocrText) {
      sendUpdate('error', { message: 'No text was detected in the selected area.' });
      return;
    }

    // Translation is no longer automatic — OCR result shows immediately (faster: no
    // waiting on a translate API round trip when the user just wants the raw text), and
    // the popup has its own "Translate" button that calls the 'translate:start' IPC
    // handler below on demand.
    sendUpdate('result', { ocrText });
  } catch (err) {
    console.error('[main] capture flow failed:', err);
    ensurePopupWindow();
    sendUpdate('error', { message: err && err.message ? err.message : String(err) });
  } finally {
    captureInProgress = false;
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Capture && Translate', click: () => startCaptureFlow() },
    { label: 'Settings', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(assetPath('assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('OCR Translator');
  tray.setContextMenu(buildTrayMenu());

  // NOTE (Linux caveat): Electron's Tray 'click' event is unreliable on Linux — most
  // desktop tray implementations (libappindicator/StatusNotifierItem, which is what
  // GNOME Shell uses via the AppIndicator extension) only support opening the context
  // menu on click and never fire a distinct 'click' event at all. We wire it up anyway
  // since it's harmless and does work in some environments (or with 'right click for
  // menu' style indicators), but "Capture & Translate" is also always the first,
  // default context-menu item so it's reachable either way.
  tray.on('click', () => startCaptureFlow());
}

function registerIpcHandlers() {
  ipcMain.handle('capture:start', () => {
    startCaptureFlow(); // fire-and-forget; progress comes via 'capture:update' pushes
    return { ok: true };
  });

  ipcMain.handle('settings:get', () => settingsStore.getSettings());

  ipcMain.handle('settings:save', async (_event, candidate) => {
    const result = settingsStore.saveSettings(candidate);
    if (result.ok) {
      // Re-registering the shortcuts is a real (if fast) system call, not just writing
      // our own JSON — don't let a failure here (e.g. gsettings missing) block the save
      // the user actually asked for, but do surface it distinctly from a validation error.
      try {
        await gnomeShortcuts.applyShortcuts(settingsStore.getSettings(), selfInvokeCommand('capture'));
      } catch (err) {
        console.error('[main] failed to apply shortcuts:', err);
        return { ok: true, shortcutWarning: `Settings saved, but shortcuts could not be applied: ${err.message}` };
      }
    }
    return result;
  });

  ipcMain.handle('clipboard:copy', (_event, text) => {
    clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''));
    return { ok: true };
  });

  ipcMain.handle('popup:close', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.close();
    }
    return { ok: true };
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
    return { ok: true };
  });

  // On-demand translation, triggered by the popup's "Translate" button — not part of the
  // automatic capture flow above. Re-reads settings fresh (rather than the ones from when
  // OCR ran) in case the user changed them in between.
  ipcMain.handle('translate:start', async (_event, text) => {
    try {
      const settings = settingsStore.getSettings();
      const translation = await translate.translateText(text, settings);
      return { ok: true, translation: translation ? translation.trim() : translation };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide(); // no dock/taskbar presence anywhere — tray-only, per spec
  }
  registerIpcHandlers();
  createTray(); // best-effort: broken via libayatana-appindicator on some GNOME/Electron
  // combos (confirmed on Ubuntu 26.04 / GNOME Shell 50.1 / Electron 44 — the extension logs
  // "NameHasNoOwner" when Electron tries to register the StatusNotifierItem). Harmless no-op
  // when it fails; activation doesn't depend on it — see the global-shortcut wiring below.

  // A bare `electron .` (autostart, no flags) just brings the daemon up idle. If this
  // very launch is what the global shortcut ran (nothing was running yet to catch it via
  // 'second-instance' above), honor the flag immediately instead of silently swallowing it.
  const initialAction = actionFromArgv(process.argv);
  if (initialAction) runAction(initialAction);

  // Pre-warm the OCR worker now (multi-second WASM/engine init) so it's not the first
  // capture that pays for it — fire-and-forget, runOcr() will init on demand anyway if
  // this hasn't finished (or failed) by the time the user actually captures something.
  ocr.warmUp(settingsStore.getSettings().ocrLanguages);

  // Re-apply the configured shortcuts on every launch (idempotent) rather than only when
  // Settings is saved — makes this self-healing after a fresh install/reinstall instead
  // of depending on the user opening Settings once before the shortcuts exist at all.
  gnomeShortcuts
    .applyShortcuts(settingsStore.getSettings(), selfInvokeCommand('capture'))
    .catch((err) => console.error('[main] failed to apply shortcuts at startup:', err));

  // Same self-healing idea for login autostart: rewrite the .desktop entry every launch so
  // it always points at wherever this binary currently actually is.
  try {
    autostart.ensureAutostartEntry(selfInvokeCommand(null), assetPath('assets', 'app-icon.png'));
  } catch (err) {
    console.error('[main] failed to write autostart entry:', err);
  }
});

app.on('will-quit', () => {
  ocr.shutdown();
});

// Global activation, without a working tray or Electron's globalShortcut (X11-only, and
// unusable here since the session is Wayland): a GNOME custom keyboard shortcut runs
// `bin/trigger.sh capture` (see that script + README), which launches `electron . --capture`.
// Thanks to the single-instance lock above, that either becomes the primary instance (cold
// start — handled by the initialAction check above) or gets forwarded to the already-running
// instance via 'second-instance'. Either way startCaptureFlow()/createSettingsWindow() runs
// in the one real process. This sidesteps the xdg-desktop-portal GlobalShortcuts negotiation
// entirely by reusing GNOME's own native custom-shortcut mechanism as the trigger.
