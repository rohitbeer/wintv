# WinTV: first sign-in of every new account (Default-profile RunOnce).
# Every account gets the WinTV lock screen picture; only tv also gets the
# WinTV shell in place of Explorer (admin keeps Explorer for repair mode).
$log = Join-Path $env:LOCALAPPDATA 'WinTV\firstlogon.log'
New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
function Log([string]$m) { "$(Get-Date -Format s) $m" | Out-File $log -Append -Encoding utf8 }

# The lock screen picture is per account, and it is also the background of
# Windows' sign-in screen. Set with Windows' own API, the one Settings uses,
# so it works on every edition (the machine-wide policy is Enterprise-only).
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $ext = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
    $asTaskOp = $ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    $asTaskAction = $ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
    [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    [void][Windows.System.UserProfile.LockScreen, Windows.System.UserProfile, ContentType = WindowsRuntime]
    $op = [Windows.Storage.StorageFile]::GetFileFromPathAsync("$env:ProgramData\WinTV\payload\art\lockscreen.jpg")
    $file = $asTaskOp.MakeGenericMethod([Windows.Storage.StorageFile]).Invoke($null, @($op)).Result
    $asTaskAction.Invoke($null, @([Windows.System.UserProfile.LockScreen]::SetImageFileAsync($file))).Wait()
    Log 'lock screen picture set'
} catch {
    Log "lock screen picture not set: $($_.Exception.Message)"
}

if ($env:USERNAME -ne 'tv') { exit 0 }
$k = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon'
if (-not (Test-Path $k)) { New-Item -Path $k | Out-Null }
# --supervise: a small parent that restarts the shell if it ever exits.
# The version to run is in current.json; WinTV updates rewrite this value (updates.ps1).
$version = (Get-Content "$env:ProgramFiles\WinTV\current.json" -Raw | ConvertFrom-Json).version
Set-ItemProperty $k -Name Shell -Value "`"$env:ProgramFiles\WinTV\versions\$version\WinTV.exe`" --supervise"
Log 'shell set to WinTV; restarting into it'
shutdown.exe /r /t 2 /c "Starting WinTV"
