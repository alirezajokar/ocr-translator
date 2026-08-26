#!/usr/bin/env bash
# Starts the OCR Translator background daemon with no action flag — used by the
# autostart .desktop entry (~/.config/autostart/ocr-translator.desktop) so it just
# comes up idle at login. Activation happens later via trigger.sh (bound to GNOME
# keyboard shortcuts), which forwards to this same running process.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec npx --no-install electron .
