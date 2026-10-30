#!/usr/bin/env bash
# On the Proxmox host, the fast test loop for shell changes: build the
# payload, install the new shell and setup scripts into the test VM the way
# setup does (versions\<x.y.z>, current.json, update tasks), restart Windows,
# and wait until the shell's input helper is up. Use vm/release.sh plus the
# WinTVUpdate task to test the real update path instead.
#   vm/deploy-shell.sh
set -euo pipefail
T=$(cd "$(dirname "$0")" && pwd)
ID=${ID:-222}
"$T/make-iso.sh" vm | tail -2
# Eject first: make-iso.sh replaces the ISO file, and re-setting the same
# path leaves QEMU reading the old, deleted file (the VM then copies the
# previous build).
qm set "$ID" --sata2 none,media=cdrom >/dev/null
sleep 2
qm set "$ID" --sata2 local:iso/wintv-payload-vm.iso,media=cdrom >/dev/null
sleep 5
# The install runs as a script file with -ExecutionPolicy Bypass (Windows
# refuses to dot-source common.ps1 otherwise), sent base64 so no quoting
# survives the trip. The guest agent call errors when Windows restarts under it.
read -r -d '' PS <<'PSEOF' || true
$ErrorActionPreference = 'Stop'
$d = (Get-Volume | Where-Object { $_.DriveType -eq 'CD-ROM' -and (Test-Path ($_.DriveLetter + ':\wintv\shell\WinTV.exe')) }).DriveLetter
$v = (Get-Content "$($d):\wintv\build.json" -Raw | ConvertFrom-Json).shellVersion
$pf = "$env:ProgramFiles\WinTV"
Get-Process WinTV, brave -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
robocopy "$($d):\wintv\shell" "$pf\versions\$v" /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
robocopy "$($d):\wintv\setup" C:\ProgramData\WinTV\payload\setup /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
# Files copied off a CD keep its read-only flag.
attrib -R "$pf\versions\$v\*" /S /D | Out-Null
attrib -R C:\ProgramData\WinTV\payload\setup\* /S /D | Out-Null
# Older test installs had the shell directly in Program Files\WinTV.
Get-ChildItem $pf | Where-Object { $_.Name -notin 'versions', 'current.json' } | Remove-Item -Recurse -Force
[IO.File]::WriteAllText("$pf\current.json", (@{ version = $v; bad = @() } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
. C:\ProgramData\WinTV\payload\setup\common.ps1
Register-UpdateTasks
Set-TvShell $v
Remove-Item C:\Users\tv\AppData\Roaming\WinTV\shell.log -ErrorAction SilentlyContinue
"installed $v"
Restart-Computer -Force
PSEOF
B=$(printf '%s' "$PS" | base64 -w0)
ID=$ID "$T/gx.sh" "[IO.File]::WriteAllBytes('C:\Windows\Temp\wintv-deploy.ps1', [Convert]::FromBase64String('$B')); powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Windows\Temp\wintv-deploy.ps1" || true
sleep 20
until ID=$ID "$T/gx.sh" 'if ((Get-Content C:\Users\tv\AppData\Roaming\WinTV\shell.log -ErrorAction SilentlyContinue) -match "input: ready") { exit 0 } else { exit 1 }' >/dev/null 2>&1; do
  sleep 5
done
ID=$ID "$T/gx.sh" 'Get-Content C:\Users\tv\AppData\Roaming\WinTV\shell.log | Select-Object -Last 4'
