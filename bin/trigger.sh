#!/usr/bin/env bash
# Dev convenience only — NOT what the actual GNOME keyboard shortcut invokes anymore.
# main.js computes and self-registers its own invocation command at every startup (see
# `selfInvokeCommand()`), so the shortcut works correctly whether running from source or
# from an installed package without depending on this project-relative script. This is
# just a handy way to trigger the same actions by hand from a terminal while developing.
#
# Usage: trigger.sh <capture|settings|quit>
#
# This does NOT start a second app instance in any user-visible sense: main.js's
# single-instance lock means that if the daemon (started at login via the autostart
# .desktop entry) is already running, this just forwards the action to it via
# Electron's 'second-instance' event and immediately exits. If the daemon isn't
# running yet, this launch becomes the real daemon and performs the action itself.
#
# For a flag-less idle daemon launch (used by the autostart entry), use daemon.sh
# instead — this script always requires an explicit action.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <capture|settings|quit>" >&2
  exit 1
fi
action="$1"
case "$action" in
  capture|settings|quit) ;;
  *)
    echo "Usage: $0 <capture|settings|quit>" >&2
    exit 1
    ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec npx --no-install electron . "--${action}"
