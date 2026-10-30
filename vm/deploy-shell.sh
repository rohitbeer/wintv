#!/usr/bin/env bash
# On the Proxmox host, the fast test loop for shell changes: build the
# payload, copy the new shell into VM 222's Program Files, restart Windows,
# and wait until the shell's input helper is up.
#   vm/deploy-shell.sh
set -euo pipefail
T=$(dirname "$0")
ID=${ID:-222}
"$T/make-iso.sh" vm | tail -2
qm set "$ID" --sata2 local:iso/wintv-payload-vm.iso,media=cdrom >/dev/null
sleep 3
# The guest agent call returns an error when Windows restarts under it.
ID=$ID "$T/gx.sh" '
$d = (Get-Volume | Where-Object { $_.DriveType -eq "CD-ROM" -and (Test-Path ($_.DriveLetter + ":\wintv\shell\WinTV.exe")) }).DriveLetter
Get-Process WinTV, brave -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
robocopy "$($d):\wintv\shell" "C:\Program Files\WinTV" /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1
Remove-Item C:\Users\tv\AppData\Roaming\WinTV\shell.log -ErrorAction SilentlyContinue
Restart-Computer -Force
' || true
sleep 20
until ID=$ID "$T/gx.sh" 'if ((Get-Content C:\Users\tv\AppData\Roaming\WinTV\shell.log -ErrorAction SilentlyContinue) -match "input: ready") { exit 0 } else { exit 1 }' >/dev/null 2>&1; do
  sleep 5
done
ID=$ID "$T/gx.sh" 'Get-Content C:\Users\tv\AppData\Roaming\WinTV\shell.log | Select-Object -Last 4'
