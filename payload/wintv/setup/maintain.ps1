# WinTV, every boot as SYSTEM (task \WinTV\Maintain). Puts back what Windows
# or an update may have undone: autologon for tv, and Edge staying removed.
. "$PSScriptRoot\common.ps1"
$Stage = 'boot'
Invoke-Step 'autologon' { Set-AutoLogon }
if (Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") {
    Invoke-Step 'Edge came back: removing it again' { Remove-Edge }
}
