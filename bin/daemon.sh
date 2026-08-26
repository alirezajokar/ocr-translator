#!/usr/bin/env bash
# Dev convenience only — the real autostart entry is self-written by main.js
# (lib/autostart.js, via `selfInvokeCommand()`) so it points at wherever the app actually
# runs from (source or installed package), not at this project-relative script. This is
# just a handy way to start the idle daemon by hand from a terminal while developing.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec npx --no-install electron .
