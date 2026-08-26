'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// v1 storage: a plain JSON file under the OS-appropriate userData directory.
//
// SECURITY NOTE: the API key is stored here in PLAINTEXT. This is an accepted MVP
// limitation for a locally-run, single-user dev tool — do NOT "fix" this by bolting on
// fake/reversible "encryption" (an XOR cipher or an obfuscated key stored next to the
// data protects against nothing). A real fix would be OS keychain integration
// (libsecret/keytar-style, or Electron's safeStorage API which itself just wraps the
// OS keyring) — that's a deliberate v2 task, not something to silently half-do here.

const DEFAULTS = Object.freeze({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  targetLanguage: 'Persian',
  ocrLanguages: 'eng+fas',
  // GTK accelerator string (e.g. "<Control><Alt>o") — applied as a GNOME custom
  // keybinding by lib/gnomeShortcuts.js. See that file for why this can't just be
  // Electron's globalShortcut (doesn't work on Wayland). Settings has no shortcut of its
  // own — it's reached via the tray menu instead, since it's opened rarely.
  captureShortcut: '<Control><Alt>o',
});

const FIELDS = Object.keys(DEFAULTS);

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getSettings() {
  const file = settingsFilePath();
  let stored = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    stored = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[settingsStore] failed to read/parse settings.json, using defaults:', err);
    }
    stored = {};
  }
  const merged = { ...DEFAULTS };
  for (const key of FIELDS) {
    if (typeof stored[key] === 'string') merged[key] = stored[key];
  }
  return merged;
}

// Returns { ok: true } or { ok: false, error: string }. Validates on the privileged
// (main-process) side — the renderer's input is never trusted just because it came
// from our own settings form.
function saveSettings(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, error: 'Invalid settings payload.' };
  }

  const next = { ...DEFAULTS };
  for (const key of FIELDS) {
    const val = candidate[key];
    if (typeof val !== 'string') {
      return { ok: false, error: `Field "${key}" must be a string.` };
    }
    next[key] = val.trim();
  }

  if (!/^https?:\/\/.+/i.test(next.baseUrl)) {
    return { ok: false, error: 'Base URL must start with http:// or https://' };
  }
  next.baseUrl = next.baseUrl.replace(/\/+$/, ''); // strip trailing slash(es)

  if (!next.model) {
    return { ok: false, error: 'Model name is required.' };
  }
  if (!next.targetLanguage) {
    return { ok: false, error: 'Target language is required.' };
  }
  if (!next.ocrLanguages) {
    return { ok: false, error: 'OCR languages is required.' };
  }
  // apiKey may legitimately be empty at this point (user hasn't set one yet) —
  // the translate step will surface a clear error if it's missing when used.

  // GTK accelerator syntax: one or more "<Modifier>" tokens followed by a key name.
  // Requiring at least one modifier avoids accidentally binding a shortcut to a bare key
  // that would fire while the user is just typing normally elsewhere.
  if (!/^(<[A-Za-z]+>)+\S+$/.test(next.captureShortcut)) {
    return {
      ok: false,
      error: 'Capture shortcut must include at least one modifier key (e.g. Ctrl+Alt+O).',
    };
  }

  try {
    fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
    fs.writeFileSync(settingsFilePath(), JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600, // best-effort: owner-only read/write, since it holds a plaintext API key
    });
  } catch (err) {
    console.error('[settingsStore] failed to write settings.json:', err);
    return { ok: false, error: 'Could not write settings file: ' + err.message };
  }

  return { ok: true };
}

module.exports = { getSettings, saveSettings, DEFAULTS };
