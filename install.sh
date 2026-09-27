#!/usr/bin/env bash
#
#  Website Generator — click to install (Linux and macOS)
#
#  Double-click this file, or run ./install.sh. It installs the application on
#  this computer and then offers to start it.
#
#  Everything it does is in scripts/install-app.mjs, which is readable and which
#  drives the same first-launch setup the packaged Windows application does.
#  This file exists so that nobody has to open a terminal to run it — on most
#  desktops, double-clicking an executable .sh offers to run it.
#
set -u
cd "$(dirname "$0")" || exit 1

if [ ! -f package.json ]; then
  printf '\n  This file has to stay in the Website Generator folder.\n'
  printf '  Move it back next to package.json and try again.\n\n'
  read -r -p "  Press Enter to close. " _ || true
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf '\n  Node.js is needed and was not found.\n'
  printf '  Install it from https://nodejs.org (or your package manager) and run this again.\n\n'
  read -r -p "  Press Enter to close. " _ || true
  exit 1
fi

node scripts/install-app.mjs "$@"
CODE=$?

printf '\n'
if [ "$CODE" -ne 0 ]; then
  printf '  Something did not finish. Nothing has been lost — run this again to carry on.\n'
fi

# Double-clicked from a file manager, the window closes the moment this exits.
if [ -t 0 ]; then
  read -r -p "  Press Enter to close. " _ || true
fi
exit "$CODE"
