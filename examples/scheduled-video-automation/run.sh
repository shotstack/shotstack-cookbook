#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
umask 077
if ! command -v flock >/dev/null; then
  echo 'flock not found. Install util-linux, or run: node --env-file=.env videos.mjs'
  exit 1
fi
if ! command -v node >/dev/null; then
  echo 'node not found on PATH. Add its directory to the PATH line in your crontab'
  exit 1
fi
exec 9>.run.lock
if ! flock -n 9; then
  echo 'Another worker is running; skipping this tick.'
  exit 0
fi
node --env-file=.env videos.mjs "$@"
