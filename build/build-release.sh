#!/usr/bin/env bash
# Build a WinTV release package for updating installed TVs (D-28):
#   out/release/<version>/wintv-<version>.zip   shell/ (the app) + setup/ (setup scripts)
#   out/release/<version>/manifest.json         name, version, package size and SHA-256
# The manifest is signed afterwards with the release key, which never comes
# here (vm/release.sh signs it on the machine that holds the key).
#   build/build-release.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(node -p "require('$ROOT/shell/package.json').version")
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version $VERSION is not x.y.z"; exit 1; }
OUT=$ROOT/out/release/$VERSION
rm -rf "$OUT" && mkdir -p "$OUT"

echo "== shell $VERSION"
(cd "$ROOT/shell" && npm ci --no-audit --no-fund --loglevel=error && node build.mjs)

echo "== package"
python3 - "$ROOT" "$OUT" "$VERSION" <<'PY'
import hashlib, json, os, sys, zipfile, datetime
root, out, version = sys.argv[1:]
name = f"wintv-{version}.zip"
parts = {"shell": os.path.join(root, "shell/dist/WinTV-win32-x64"), "setup": os.path.join(root, "payload/wintv/setup")}
with zipfile.ZipFile(os.path.join(out, name), "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for prefix, src in parts.items():
        for dirpath, _, files in os.walk(src):
            for f in sorted(files):
                full = os.path.join(dirpath, f)
                z.write(full, os.path.join(prefix, os.path.relpath(full, src)))
data = open(os.path.join(out, name), "rb").read()
manifest = {"name": "wintv", "version": version,
            "released": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "package": {"file": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}}
open(os.path.join(out, "manifest.json"), "w").write(json.dumps(manifest, indent=2) + "\n")
print(f"{name}: {len(data) // 1048576} MB")
PY
ls -la "$OUT"
