'use strict';

const { execFile } = require('child_process');

// Registers our two global shortcuts as GNOME custom keybindings (gsettings), the same
// mechanism set up manually while building this app — see main.js's top-of-file comment
// for why: Electron's globalShortcut module doesn't work on Wayland, and there's no
// portal-free way around that, so activation has to go through the OS's own shortcut
// system instead. This module just makes that configurable from the app's own Settings
// UI instead of requiring the user to run gsettings by hand.
//
// GNOME's custom-keybindings list is shared across every app that uses it, so we only
// ever add/update our own two named slots — never touch entries we didn't create.

const SCHEMA_LIST = 'org.gnome.settings-daemon.plugins.media-keys';
const SCHEMA_BINDING = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
const BASE_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings';
const CAPTURE_SLOT = `${BASE_PATH}/ocrtranslator-capture/`;
// Settings used to also get a global shortcut, but it's reached often enough via the tray
// menu (and rarely enough in general) that a dedicated global shortcut wasn't worth it —
// removed per user request. SETTINGS_SLOT is kept only so unregisterSlot() below can clean
// up anyone's existing registration from before this change; nothing registers it anymore.
const SETTINGS_SLOT = `${BASE_PATH}/ocrtranslator-settings/`;

function runGsettings(args) {
  return new Promise((resolve, reject) => {
    execFile('gsettings', args, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function getCustomList() {
  const out = await runGsettings(['get', SCHEMA_LIST, 'custom-keybindings']);
  const match = out.match(/\[(.*)\]/s);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^'(.*)'$/, '$1'))
    .filter(Boolean);
}

async function setCustomList(paths) {
  const literal = `[${paths.map((p) => `'${p}'`).join(', ')}]`;
  await runGsettings(['set', SCHEMA_LIST, 'custom-keybindings', literal]);
}

async function ensureSlotRegistered(slotPath) {
  const list = await getCustomList();
  if (!list.includes(slotPath)) {
    await setCustomList([...list, slotPath]);
  }
}

async function applyBinding(slotPath, name, command, binding) {
  const schemaWithPath = `${SCHEMA_BINDING}:${slotPath}`;
  await runGsettings(['set', schemaWithPath, 'name', name]);
  await runGsettings(['set', schemaWithPath, 'command', command]);
  await runGsettings(['set', schemaWithPath, 'binding', binding]);
}

async function unregisterSlot(slotPath) {
  const list = await getCustomList();
  if (list.includes(slotPath)) {
    await setCustomList(list.filter((p) => p !== slotPath));
  }
  const schemaWithPath = `${SCHEMA_BINDING}:${slotPath}`;
  for (const key of ['name', 'command', 'binding']) {
    try {
      await runGsettings(['reset', schemaWithPath, key]);
    } catch {
      // best-effort — nothing to reset if it was never set
    }
  }
}

/**
 * Registers (or updates) the Capture & Translate global shortcut, using the accelerator
 * string from settings. Also cleans up the old Settings shortcut slot if it's still
 * registered from before that feature was removed. Throws on failure — caller decides how
 * to surface that (e.g. non-fatal toast, since the shortcut not being registered doesn't
 * break anything else in the app).
 */
async function applyShortcuts({ captureShortcut }, triggerScriptPath) {
  await ensureSlotRegistered(CAPTURE_SLOT);
  await applyBinding(
    CAPTURE_SLOT,
    'OCR Translator: Capture & Translate',
    `${triggerScriptPath} capture`,
    captureShortcut
  );
  await unregisterSlot(SETTINGS_SLOT);
}

module.exports = { applyShortcuts };
