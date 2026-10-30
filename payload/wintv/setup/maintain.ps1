# WinTV, every boot as SYSTEM (task \WinTV\Maintain). Puts back what Windows
# or an update may have undone: autologon for tv, and Edge staying removed.
. "$PSScriptRoot\common.ps1"
$Stage = 'boot'
Invoke-Step 'autologon' { Set-AutoLogon }
# Only if Edge was removed once and an update brought it back. If it was never
# removed (see Remove-Edge), retrying at every boot would only fill the log.
if ((Test-Path $EdgeRemovedMark) -and (Test-Path $EdgeExe)) {
    Invoke-Step 'Edge came back: removing it again' { Remove-Edge }
}
# The TV's shell must point at an installed version (D-28).
Invoke-Step 'TV shell points at the installed version' {
    $v = (Get-Content "$env:ProgramFiles\WinTV\current.json" -Raw | ConvertFrom-Json).version
    if (-not (Test-Path "$env:ProgramFiles\WinTV\versions\$v\WinTV.exe")) { throw "version $v from current.json is not installed" }
    Set-TvShell $v
}
