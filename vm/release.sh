#!/usr/bin/env bash
# On the machine that holds the release key: build a release in the build
# container, sign its manifest, and keep the three files in WINTV_RELEASES.
# With --publish, also attach them to a GitHub release (vX.Y.Z) of the
# public repo; installed TVs fetch .../releases/latest/download/manifest.json.
#   vm/release.sh [--publish]
# Settings (local.env): WINTV_BUILD_CT, WINTV_REPO, WINTV_RELEASE_KEY (RSA
# private key, PEM; create with: openssl genrsa -out key.pem 3072), WINTV_RELEASES.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/local.env" ] && . "$HERE/local.env"
CT=${WINTV_BUILD_CT:?set WINTV_BUILD_CT in local.env}
REPO=${WINTV_REPO:?set WINTV_REPO in local.env}
KEY=${WINTV_RELEASE_KEY:?set WINTV_RELEASE_KEY in local.env}
DEST=${WINTV_RELEASES:?set WINTV_RELEASES in local.env}
GH_REPO=${WINTV_GH_REPO:-rohitbeer/wintv}

pct exec "$CT" -- bash -lc "cd $REPO && build/build-release.sh"
VERSION=$(pct exec "$CT" -- node -p "require('$REPO/shell/package.json').version")
OUT=$DEST/$VERSION
rm -rf "$OUT" && mkdir -p "$OUT"
pct exec "$CT" -- tar -C "$REPO/out/release/$VERSION" -cf - . | tar -C "$OUT" -xf -

# RSA PKCS#1 v1.5 over SHA-256 of the manifest's exact bytes; updates.ps1
# checks it with the public key in payload/wintv/setup/release-key.xml.
openssl dgst -sha256 -sign "$KEY" -out "$OUT/manifest.sig" "$OUT/manifest.json"
openssl dgst -sha256 -verify <(openssl rsa -in "$KEY" -pubout 2>/dev/null) -signature "$OUT/manifest.sig" "$OUT/manifest.json"
ls -la "$OUT"

if [ "${1:-}" = --publish ]; then
  pct exec "$CT" -- mkdir -p "/tmp/wintv-release-$VERSION"
  for f in "$OUT"/*; do pct push "$CT" "$f" "/tmp/wintv-release-$VERSION/$(basename "$f")"; done
  pct exec "$CT" -- bash -lc "cd $REPO && gh release create v$VERSION --repo $GH_REPO --title 'WinTV $VERSION' --notes 'See decision.md for what changed.' /tmp/wintv-release-$VERSION/*"
  pct exec "$CT" -- rm -rf "/tmp/wintv-release-$VERSION"
fi
