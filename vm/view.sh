#!/usr/bin/env bash
# PNG -> JPEG (for viewing) through the headless Chromium in the build container.
set -euo pipefail
IN=$1; OUT=${2:-${1%.png}.jpg}
cat "$IN" | pct exec "${WINTV_BUILD_CT:?}" -- bash -c 'cat > /tmp/view-in.png && node /tmp/topng-any.mjs /tmp/view-in.png /tmp/view-out.jpg' 
pct exec "${WINTV_BUILD_CT:?}" -- cat /tmp/view-out.jpg > "$OUT"; echo "$OUT"
