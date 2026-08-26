'use strict';

const fields = {
  baseUrl: document.getElementById('baseUrl'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  targetLanguage: document.getElementById('targetLanguage'),
  ocrLanguages: document.getElementById('ocrLanguages'),
};
const statusMsg = document.getElementById('statusMsg');

// -- global shortcut: recorded by keypress, stored as a GTK accelerator string like
// "<Control><Alt>o" (what lib/gnomeShortcuts.js hands to gsettings), not plain text
// input — see the "press your key combo" UX this drives below.
const shortcuts = { captureShortcut: '' };
let recordingField = null;

function humanizeAccel(accel) {
  if (!accel) return '(not set)';
  const modNames = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Super' };
  const mods = [];
  let rest = accel;
  const modRe = /^<(Control|Alt|Shift|Super)>/;
  let m;
  while ((m = modRe.exec(rest))) {
    mods.push(modNames[m[1]]);
    rest = rest.slice(m[0].length);
  }
  const keyLabel = rest.length === 1 ? rest.toUpperCase() : rest;
  return [...mods, keyLabel].join('+');
}

// Derived from e.code (not e.key) so Shift doesn't turn "o" into "O" or a symbol —
// we want the physical key, independent of which modifiers are held.
function keyLabelFromEvent(e) {
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const special = {
    Space: 'space',
    Escape: 'Escape',
    Enter: 'Return',
    Tab: 'Tab',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backspace: 'BackSpace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page_Up',
    PageDown: 'Page_Down',
    Insert: 'Insert',
  };
  return special[code] || null;
}

function renderShortcutButtons() {
  document.getElementById('captureShortcutBtn').textContent = humanizeAccel(shortcuts.captureShortcut);
}

function stopRecording(btn) {
  if (btn) btn.classList.remove('recording');
  document.removeEventListener('keydown', onRecordKeydown, true);
  recordingField = null;
}

function onRecordKeydown(e) {
  if (!recordingField) return;
  e.preventDefault();
  e.stopPropagation();

  const btn = document.querySelector(`[data-field="${recordingField}"]`);

  if (e.key === 'Escape') {
    renderShortcutButtons(); // revert to the last committed value
    stopRecording(btn);
    return;
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    return; // a bare modifier press — keep waiting for the real key
  }

  const keyLabel = keyLabelFromEvent(e);
  if (!keyLabel) return; // unsupported/unmapped key — keep waiting rather than guess

  const mods = [];
  if (e.ctrlKey) mods.push('<Control>');
  if (e.altKey) mods.push('<Alt>');
  if (e.shiftKey) mods.push('<Shift>');
  if (e.metaKey) mods.push('<Super>');

  if (mods.length === 0) {
    btn.textContent = 'Need Ctrl, Alt, or Super too…';
    return;
  }

  shortcuts[recordingField] = mods.join('') + keyLabel;
  renderShortcutButtons();
  stopRecording(btn);
}

document.querySelectorAll('.shortcut-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (recordingField) {
      stopRecording(document.querySelector(`[data-field="${recordingField}"]`));
      renderShortcutButtons();
    }
    recordingField = btn.getAttribute('data-field');
    btn.classList.add('recording');
    btn.textContent = 'Press keys… (Esc to cancel)';
    document.addEventListener('keydown', onRecordKeydown, true);
  });
});

async function load() {
  const settings = await window.api.getSettings();
  for (const key of Object.keys(fields)) {
    fields[key].value = settings[key] ?? '';
  }
  shortcuts.captureShortcut = settings.captureShortcut || '';
  renderShortcutButtons();
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {};
  for (const key of Object.keys(fields)) {
    payload[key] = fields[key].value;
  }
  payload.captureShortcut = shortcuts.captureShortcut;

  statusMsg.textContent = 'Saving…';
  statusMsg.className = 'status-msg';

  const result = await window.api.saveSettings(payload);
  if (result.ok) {
    statusMsg.textContent = result.shortcutWarning || 'Saved.';
    statusMsg.className = result.shortcutWarning ? 'status-msg warn' : 'status-msg ok';
  } else {
    statusMsg.textContent = result.error || 'Could not save settings.';
    statusMsg.className = 'status-msg err';
  }
  setTimeout(() => {
    statusMsg.textContent = '';
    statusMsg.className = 'status-msg';
  }, 4000);
});

document.getElementById('quitBtn').addEventListener('click', () => {
  window.api.quitApp();
});

load();
