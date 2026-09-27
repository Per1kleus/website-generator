#!/usr/bin/env bash
#
#  Starts Website Generator, once install.sh has been run.
#
set -u
cd "$(dirname "$0")" || exit 1
exec node scripts/install-app.mjs --start "$@"
