#!/usr/bin/env bash
# On the Proxmox host: create the disposable WinTV test VM and start the
# unattended install. Its firewall rules come from WINTV_FIREWALL (local.env;
# see vm/firewall.example.fw).
#   vm/create-vm.sh [--fresh]     --fresh destroys an existing test VM first
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/local.env" ] && . "$HERE/local.env"
ID=${ID:-222}
WINISO=${WINISO:-local:iso/win11-26h2-enterprise-eval-en-us.iso}
PAYLOAD=${PAYLOAD:-local:iso/wintv-payload-vm.iso}
FW=/etc/pve/firewall/$ID.fw
RULES=${WINTV_FIREWALL:?set WINTV_FIREWALL in local.env (see vm/firewall.example.fw)}

# The VM must never boot without its fence. `qm destroy --purge` deletes
# the firewall file too, so the rules are copied in again every time.
[ -s "$RULES" ] || { echo "firewall rules $RULES missing; refusing to create VM $ID"; exit 1; }

if qm status "$ID" >/dev/null 2>&1; then
  [ "${1:-}" = --fresh ] || { echo "VM $ID exists; pass --fresh to destroy and recreate it"; exit 1; }
  qm stop "$ID" --skiplock 1 >/dev/null 2>&1 || true
  qm destroy "$ID" --purge 1
fi

# SATA disk and e1000e NIC: Windows has drivers for both out of the box.
# vTPM 2.0 + Secure Boot keys: a real Windows 11 machine, no bypasses.
qm create "$ID" --name wintv-test --ostype win11 --machine q35 --bios ovmf --cpu host \
  --cores 4 --memory 8192 --balloon 0 \
  --efidisk0 local-lvm:1,efitype=4m,pre-enrolled-keys=1 \
  --tpmstate0 local-lvm:1,version=v2.0 \
  --sata0 local-lvm:64,discard=on,ssd=1 \
  --sata1 "$WINISO",media=cdrom \
  --sata2 "$PAYLOAD",media=cdrom \
  --net0 e1000e,bridge=vmbr0,firewall=1 \
  --vga virtio,memory=64 --audio0 device=ich9-intel-hda,driver=none --agent enabled=1 \
  --boot 'order=sata0;sata1' --onboot 0 \
  --description 'WinTV test VM (stock Windows 11 eval + WinTV payload). Disposable.'
cp "$RULES" "$FW"
pve-firewall compile >/dev/null
qm start "$ID"
# The firmware asks "Press any key to boot from CD or DVD" for a few seconds.
for _ in $(seq 1 12); do sleep 1; qm sendkey "$ID" ret >/dev/null 2>&1 || true; done
echo "VM $ID is installing; watch with vm/shot.sh"
