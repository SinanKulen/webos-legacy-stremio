#!/usr/bin/env bash
# Package the app as an .ipk for webOS. Requires: npm i -g @webos-tools/cli
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f app/config.js ]; then
  echo "app/config.js not found - creating it from config.example.js (no API keys)."
  cp app/config.example.js app/config.js
fi
mkdir -p dist
ares-package app -o dist
ls -1 dist/*.ipk
