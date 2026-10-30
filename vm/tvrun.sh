#!/usr/bin/env bash
# Run a PowerShell script inside VM 222 *as the tv user, in its session*
# (guest-agent commands run as SYSTEM in session 0, which can't see the
# TV's screen or windows). Prints whatever the script writes to $Out.
#   vm/tvrun.sh script.ps1 [wait-seconds]
set -euo pipefail
SCRIPT=${1:?usage: tvrun.sh script.ps1 [wait]}
WAIT=${2:-8}
GX=$(dirname "$0")/gx.sh
B64=$(base64 -w0 < "$SCRIPT")
"$GX" "
\$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$B64'))
Set-Content C:\\Users\\Public\\tvrun.ps1 (\"\`\$Out = 'C:\\Users\\Public\\tvrun.out'\" + [Environment]::NewLine + \$body) -Encoding UTF8
Remove-Item C:\\Users\\Public\\tvrun.out -ErrorAction SilentlyContinue
schtasks /Create /F /TN WinTVRun /SC ONCE /ST 23:59 /RU tv /IT /TR 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\\Users\\Public\\tvrun.ps1' | Out-Null
schtasks /Run /TN WinTVRun | Out-Null
Start-Sleep $WAIT
schtasks /Delete /F /TN WinTVRun | Out-Null
Get-Content C:\\Users\\Public\\tvrun.out -ErrorAction SilentlyContinue
"
