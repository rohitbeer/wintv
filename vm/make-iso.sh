#!/usr/bin/env bash
# On the Proxmox host: build the payload in the build container, add the
# household's site file and the answer file (with the admin password), and
# write the payload ISO that sits next to the stock Windows ISO.
#   vm/make-iso.sh vm|usb
# Machine settings come from local.env next to this script (see
# vm/local.env.example): WINTV_BUILD_CT, WINTV_REPO, WINTV_SECRET, WINTV_SITE.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/local.env" ] && . "$HERE/local.env"
VARIANT=${1:?usage: make-iso.sh vm|usb}
CT=${WINTV_BUILD_CT:?set WINTV_BUILD_CT in local.env}
REPO=${WINTV_REPO:?set WINTV_REPO in local.env}
SECRET=${WINTV_SECRET:?set WINTV_SECRET in local.env}
SITE=${WINTV_SITE:-}
ISO=/var/lib/vz/template/iso/wintv-payload-$VARIANT.iso
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

[ -s "$SECRET" ] || { mkdir -p "$(dirname "$SECRET")"; umask 077; head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$SECRET"; echo "new admin password in $SECRET"; }

pct exec "$CT" -- bash -lc "cd $REPO && build/build-payload.sh $VARIANT"
pct exec "$CT" -- tar -C "$REPO/out/payload-$VARIANT" -cf - wintv | tar -C "$WORK" -xf -
pct exec "$CT" -- cat "$REPO/build/autounattend.xml.in" > "$WORK/autounattend.xml.in"
# The household's site file stays on this host; it never enters the repo.
if [ -n "$SITE" ]; then mkdir -p "$WORK/wintv/config"; cp "$SITE" "$WORK/wintv/config/apps.json"; fi

python3 - "$VARIANT" "$SECRET" "$WORK" <<'PY'
import sys, html, json, pathlib, re
variant, secret, work = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
pw = html.escape(pathlib.Path(secret).read_text().strip())
# Language, regional format, keyboards and time zone: the site file's "setup",
# else neutral defaults. Each value is checked before it goes into the XML.
site = work / "wintv" / "config" / "apps.json"
setup = json.loads(site.read_text()).get("setup", {}) if site.exists() else {}
def pick(key, default, pattern):
    v = str(setup.get(key, default))
    if not re.fullmatch(pattern, v): sys.exit(f"site setup.{key} = {v!r} is not valid")
    return v
ui = pick("uiLanguage", "en-US", r"[a-z]{2,3}-[A-Z]{2}")
locale = pick("locale", "en-US", r"[a-z]{2,3}-[A-Z]{2}")
keyboards = pick("keyboards", "0409:00000409", r"[0-9A-Fa-f]{4}:[0-9A-Fa-f{}-]{8,38}(;[0-9A-Fa-f]{4}:[0-9A-Fa-f{}-]{8,38})*")
tz = pick("timeZone", "UTC", r"[A-Za-z0-9 .()+-]{2,60}")
if variant == "vm":
    image, key = "Windows 11 Enterprise Evaluation", ""
    disk = """      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>300</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Label>System</Label><Format>FAT32</Format></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>2</PartitionID></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>3</Order><PartitionID>3</PartitionID><Label>Windows</Label><Letter>C</Letter><Format>NTFS</Format></ModifyPartition>
          </ModifyPartitions>
        </Disk>
        <WillShowUI>OnError</WillShowUI>
      </DiskConfiguration>"""
    installto = "          <InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>"
    name = "WINTV-VM"
else:
    # Microsoft's published generic key only selects the Pro edition; the
    # PC's own firmware key activates it (specialize.ps1).
    image = "Windows 11 Pro"
    key = "        <ProductKey><Key>VK7JG-NPHTM-C97JM-9MPGT-3V66T</Key><WillShowUI>OnError</WillShowUI></ProductKey>"
    disk, installto, name = "", "", "*"
src = (work / "autounattend.xml.in").read_text()
for k, v in {"VARIANT": variant, "IMAGE": image, "PRODUCTKEY": key, "DISKCONFIG": disk,
             "INSTALLTO": installto, "COMPUTERNAME": name, "ADMINPASSWORD": pw,
             "UILANGUAGE": ui, "LOCALE": locale, "KEYBOARDS": keyboards, "TIMEZONE": tz}.items():
    src = src.replace(f"@@{k}@@", v)
assert "@@" not in src
(work / "autounattend.xml").write_text(src.replace("\n", "\r\n"), encoding="utf-8")
(work / "autounattend.xml.in").unlink()
PY

genisoimage -quiet -J -joliet-long -R -iso-level 3 -V WINTV_PAYLOAD -o "$ISO.part" "$WORK"
mv "$ISO.part" "$ISO"
chmod 600 "$ISO"
ls -la "$ISO"
