#!/usr/bin/env bash
# PNG -> JPEG (for viewing) through a headless Chromium in the build
# container (any script that screenshots a file:// page as JPEG will do).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/local.env" ] && . "$HERE/local.env"
CT=${WINTV_BUILD_CT:?set WINTV_BUILD_CT in local.env}
IN=$1; OUT=${2:-${1%.png}.jpg}
cat "$IN" | pct exec "$CT" -- bash -c 'cat > /tmp/view-in.png && node /tmp/topng-any.mjs /tmp/view-in.png /tmp/view-out.jpg'
pct exec "$CT" -- cat /tmp/view-out.jpg > "$OUT"; echo "$OUT"
