'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const DESKTOP_FILE = path.join(AUTOSTART_DIR, 'ocr-translator.desktop');

/**
 * Writes/updates the login-autostart .desktop entry so it always points at whatever the
 * CURRENTLY RUNNING binary actually is — works whether launched from source (`electron .`
 * during development) or from an installed package, and self-heals if the app moves
 * (e.g. dev → installed, or an upgrade changes the install path), the same way
 * lib/gnomeShortcuts.js self-heals the keyboard shortcut's target command. Called once at
 * every app startup; cheap, idempotent, safe to call unconditionally.
 */
function ensureAutostartEntry(execCommand, iconPath) {
  const contents = `[Desktop Entry]
Type=Application
Name=OCR Translator
Comment=Background screen-capture OCR + translate daemon
Exec=${execCommand}
Icon=${iconPath}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
  fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
  fs.writeFileSync(DESKTOP_FILE, contents, 'utf8');
}

module.exports = { ensureAutostartEntry };
