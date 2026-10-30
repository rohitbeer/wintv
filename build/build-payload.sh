#!/usr/bin/env bash
# Build the WinTV payload (everything except the answer file and its
# password) into out/payload-<variant>/wintv. Runs in the dev container.
#   build/build-payload.sh vm|usb
# The household's site file is added later, on the host (vm/make-iso.sh).
set -euo pipefail
VARIANT=${1:?usage: build-payload.sh vm|usb}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/out/payload-$VARIANT/wintv
CACHE=$ROOT/out/cache
rm -rf "$ROOT/out/payload-$VARIANT"
mkdir -p "$OUT/apps" "$OUT/config" "$CACHE"

echo "== shell"
(cd "$ROOT/shell" && npm ci --no-audit --no-fund --loglevel=error && node build.mjs)
cp -r "$ROOT/shell/dist/WinTV-win32-x64" "$OUT/shell"

echo "== setup scripts"
cp -r "$ROOT/payload/wintv/setup" "$OUT/setup"
mkdir -p "$OUT/art" && cp "$ROOT/payload/wintv/art/lockscreen.jpg" "$OUT/art/"

echo "== browser: Brave (latest release, hash checked against GitHub)"
tag=$(gh api repos/brave/brave-browser/releases/latest --jq .tag_name)
# The full standalone installer is tagged needsadmin=prefers: run as SYSTEM it
# installs for every account into Program Files. (The "Silent" one is tagged
# needsadmin=False and installed into SYSTEM's own profile on the first VM run.)
asset=BraveBrowserStandaloneSetup.exe
want=$(gh api repos/brave/brave-browser/releases/latest --jq ".assets[] | select(.name==\"$asset\") | .digest" | sed 's/^sha256://')
dir=$CACHE/brave-$tag
if [ ! -f "$dir/$asset" ]; then
  mkdir -p "$dir"
  curl -fsSL -o "$dir/$asset.part" "https://github.com/brave/brave-browser/releases/download/$tag/$asset"
  mv "$dir/$asset.part" "$dir/$asset"
fi
echo "$want  $dir/$asset" | sha256sum -c -
cp "$dir/$asset" "$OUT/apps/"

if [ "$VARIANT" = vm ]; then
  echo "== VM test tooling: virtio-serial driver + QEMU guest agent"
  vdir=$CACHE/virtio-win
  if [ ! -f "$vdir/virtio-win.iso" ]; then
    mkdir -p "$vdir"
    curl -fsSL -o "$vdir/virtio-win.iso.part" https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso
    mv "$vdir/virtio-win.iso.part" "$vdir/virtio-win.iso"
  fi
  rm -rf "$vdir/x" && mkdir -p "$vdir/x"
  # w11 files are hard links into 2k25, so both are extracted. viogpudo is the
  # virtio display driver: unlike Windows' basic display driver it offers
  # several resolutions, which the Settings > Display test needs.
  bsdtar -xf "$vdir/virtio-win.iso" -C "$vdir/x" vioserial/2k25/amd64 vioserial/w11/amd64 viogpudo/2k25/amd64 viogpudo/w11/amd64 guest-agent/qemu-ga-x86_64.msi
  mkdir -p "$OUT/test/vioserial" "$OUT/test/viogpudo"
  cp "$vdir"/x/vioserial/w11/amd64/* "$OUT/test/vioserial/"
  cp "$vdir"/x/viogpudo/w11/amd64/* "$OUT/test/viogpudo/"
  cp "$vdir/x/guest-agent/qemu-ga-x86_64.msi" "$OUT/test/"
fi

cat > "$OUT/build.json" <<JSON
{
  "version": "$(git -C "$ROOT" describe --always --dirty 2>/dev/null || echo dev)",
  "variant": "$VARIANT",
  "built": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "browser": "brave $tag",
  "browserSigner": "Brave Software"
}
JSON
du -sh "$OUT"
