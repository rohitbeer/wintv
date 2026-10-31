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
# The machine policies again: an update of WinTV may bring new ones (D-42),
# and Windows feature updates sometimes reset some.
Invoke-Step 'policies' { Invoke-Native "$env:SystemRoot\System32\reg.exe" @('import', "$PSScriptRoot\policies.reg") | Out-Null }
# Updates bring new setup scripts but don't register tasks; a task a newer
# release needs comes here, at the next boot (D-39).
Invoke-Step 'admin tasks' { Register-AdminTask }
# Windows 11 24H2 lists Wi-Fi networks only to apps allowed to use location,
# and setup leaves location off. Turned on once (D-44); if the admin turns it
# off later, it stays off.
$LocationMark = Join-Path $Root 'location-allowed'
if (-not (Test-Path $LocationMark)) {
    Invoke-Step 'location on, once, for the Wi-Fi list' {
        $k = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location'
        if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
        Set-ItemProperty -Path $k -Name Value -Value 'Allow'
        New-Item -ItemType File -Path $LocationMark -Force | Out-Null
    }
}
# The TV's shell must point at an installed version (D-28).
Invoke-Step 'TV shell points at the installed version' {
    $v = (Get-Content "$env:ProgramFiles\WinTV\current.json" -Raw | ConvertFrom-Json).version
    if (-not (Test-Path "$env:ProgramFiles\WinTV\versions\$v\WinTV.exe")) { throw "version $v from current.json is not installed" }
    Set-TvShell $v
}
