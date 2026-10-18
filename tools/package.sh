#!/bin/sh
# Bikin ZIP siap-upload ke Chrome Web Store (tanpa tests, tools, git, dan berkas pengembangan).
set -e
cd "$(dirname "$0")/.."
VER=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="browser-lock-v$VER.zip"
rm -f "$OUT"
zip -r -q "$OUT" manifest.json background.js content.js lock.html lock.js options.html options.js popup.html popup.js \
  offscreen.html offscreen.js strength.js ui.css lib fonts icons -x "*.DS_Store"
echo "$OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -1
