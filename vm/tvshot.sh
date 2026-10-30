#!/usr/bin/env bash
# Screenshot of what the tv account sees, taken inside Windows.
#   vm/tvshot.sh out.png
# QEMU's own screendump (shot.sh) shows the WinTV shell with its colour
# channels rotated once it is full screen, so its colours are
# checked with this one, which asks Windows for the picture.
# It briefly runs a console in the TV session, which takes the focus from
# the app in front (so the on-screen keyboard closes). Use shot.sh when
# testing anything that depends on focus.
set -euo pipefail
OUT=${1:?usage: tvshot.sh out.png}
ID=${ID:-222}
GX=$(dirname "$0")/gx.sh
ID=$ID "$GX" '
$ps = @"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
`$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
`$bmp = New-Object System.Drawing.Bitmap `$b.Width, `$b.Height
[System.Drawing.Graphics]::FromImage(`$bmp).CopyFromScreen(`$b.Location, [System.Drawing.Point]::Empty, `$b.Size)
`$bmp.Save("C:\Users\Public\tvshot.png", [System.Drawing.Imaging.ImageFormat]::Png)
"@
Set-Content C:\Users\Public\tvshot.ps1 $ps
Remove-Item C:\Users\Public\tvshot.png -ErrorAction SilentlyContinue
schtasks /Create /F /TN WinTVShot /SC ONCE /ST 23:59 /RU tv /IT /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\Users\Public\tvshot.ps1" | Out-Null
schtasks /Run /TN WinTVShot | Out-Null
for ($i = 0; $i -lt 30 -and -not (Test-Path C:\Users\Public\tvshot.png); $i++) { Start-Sleep -Milliseconds 500 }
Start-Sleep 1
schtasks /Delete /F /TN WinTVShot | Out-Null
' >/dev/null
ID=$ID "$GX" '[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\Public\tvshot.png"))' | base64 -di > "$OUT"
echo "$OUT"
