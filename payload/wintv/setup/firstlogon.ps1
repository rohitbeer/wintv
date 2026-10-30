# WinTV: first sign-in of every new account (Default-profile RunOnce).
# Only the tv account gets the launcher as its shell; admin keeps Explorer.
if ($env:USERNAME -ne 'tv') { exit 0 }
$log = Join-Path $env:LOCALAPPDATA 'WinTV\firstlogon.log'
New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
$k = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon'
if (-not (Test-Path $k)) { New-Item -Path $k | Out-Null }
Set-ItemProperty $k -Name Shell -Value "`"$env:ProgramFiles\WinTV\WinTV.exe`""
"$(Get-Date -Format s) shell set to WinTV; restarting into it" | Out-File $log -Append -Encoding utf8
shutdown.exe /r /t 2 /c "Starting WinTV"
