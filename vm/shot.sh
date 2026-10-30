#!/usr/bin/env bash
# On the Proxmox host: save the VM's screen as a PNG.   vm/shot.sh out.png
set -euo pipefail
ID=${ID:-222}
OUT=${1:-/tmp/wintv-$ID.png}
PPM=$(mktemp --suffix .ppm)
trap 'rm -f "$PPM"' EXIT
echo "screendump $PPM" | qm monitor "$ID" >/dev/null
# QEMU writes the dump asynchronously; wait until the file stops growing.
prev=-1; for _ in $(seq 1 50); do cur=$(stat -c %s "$PPM"); [ "$cur" -gt 0 ] && [ "$cur" = "$prev" ] && break; prev=$cur; sleep 0.1; done
python3 - "$PPM" "$OUT" <<'PY'
import sys, zlib, struct
data = open(sys.argv[1], 'rb').read()
parts = data.split(maxsplit=4)          # P6, width, height, maxval, pixels
w, h = int(parts[1]), int(parts[2])
px = parts[4][: w * h * 3]
raw = b''.join(b'\x00' + px[y * w * 3:(y + 1) * w * 3] for y in range(h))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) \
    + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
open(sys.argv[2], 'wb').write(png)
print(sys.argv[2], w, 'x', h)
PY
