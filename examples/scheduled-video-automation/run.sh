#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
umask 077
exec 9>.run.lock
if ! flock -n 9; then
  echo 'Another worker is running; skipping this tick.'
  exit 0
fi
node --env-file=.env videos.mjs "$@"
