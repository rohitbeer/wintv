# Shared by the setup scripts. Every step logs and carries on: a TV that is
# 95% set up is better than an install that stops halfway.
$Root    = 'C:\ProgramData\WinTV'
$Payload = Join-Path $Root 'payload'
$LogPath = Join-Path $Root 'setup.log'
$Stage   = 'setup'

function Write-Log([string]$Message) {
    if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
    "$(Get-Date -Format s) [$Stage] $Message" | Out-File -FilePath $LogPath -Append -Encoding utf8
}

function Invoke-Step([string]$Name, [scriptblock]$Body) {
    Write-Log "BEGIN $Name"
    # Any error inside a step fails that step (PowerShell's default would
    # print it and carry on, and the step would be logged as OK).
    $ErrorActionPreference = 'Stop'
    try { & $Body; Write-Log "OK    $Name" }
    catch { Write-Log "FAIL  $Name : $($_.Exception.Message)" }
}

# Start-Process glues -ArgumentList together with spaces and quotes nothing,
# so an argument like "powershell.exe -File C:\x.ps1" falls apart. Quote each
# argument the way Windows programs split them (CommandLineToArgvW rules).
function ConvertTo-NativeArgument([string]$Arg) {
    if ($Arg -eq '') { return '""' }
    if ($Arg -notmatch '[\s"]') { return $Arg }
    $quoted = [regex]::Replace($Arg, '(\\*)"', '$1$1\"')
    $quoted = [regex]::Replace($quoted, '(\\+)$', '$1$1')
    return '"' + $quoted + '"'
}

# Runs a program and fails the step unless it exits with one of $OkCodes, so
# the log never says OK for a command that did not work.
function Invoke-Native([string]$File, [string[]]$Arguments, [int[]]$OkCodes = @(0)) {
    $line = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $p = if ($line) { Start-Process -FilePath $File -ArgumentList $line -Wait -PassThru -NoNewWindow }
         else { Start-Process -FilePath $File -Wait -PassThru -NoNewWindow }
    Write-Log "  $([IO.Path]::GetFileName($File)) $line -> exit $($p.ExitCode)"
    if ($OkCodes -notcontains $p.ExitCode) { throw "$([IO.Path]::GetFileName($File)) exited with $($p.ExitCode)" }
    return $p.ExitCode
}

# Edge's own uninstaller, started with the command line Windows itself
# registers for "Uninstall". Microsoft allows removing Edge when the device
# region is in the EEA (Digital Markets Act). On the first VM run the
# uninstaller also refused every scripted start with exit code 532: it only
# accepts being started by Settings or Control Panel. That case is reported
# plainly instead of being worked around (decision D-17). WebView2 is a
# separate runtime and is left alone.
$EdgeExe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$EdgeRemovedMark = Join-Path $Root 'edge-removed'

function Remove-Edge {
    if (-not (Test-Path $EdgeExe)) { Write-Log '  Edge is not installed'; return }
    $region = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Control Panel\DeviceRegion' -ErrorAction SilentlyContinue).DeviceRegion
    Write-Log "  device region (GeoID): $region"
    $u = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge' -ErrorAction Stop).UninstallString
    if ($u -notmatch '^"([^"]+)"\s*(.*)$') { throw "unexpected Edge UninstallString: $u" }
    $exe = $Matches[1]
    $arguments = @($Matches[2] -split '\s+' | Where-Object { $_ })
    # No confirmation dialog: nobody is there to click it.
    if ($arguments -notcontains '--force-uninstall') { $arguments += '--force-uninstall' }
    # 19 is Chromium's "uninstall successful"; 532 is Edge refusing.
    $code = Invoke-Native $exe $arguments -OkCodes @(0, 19, 532)
    # Shortcuts go either way, so nothing points at Edge while it is still here.
    foreach ($lnk in @("$env:PUBLIC\Desktop\Microsoft Edge.lnk",
                       "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Microsoft Edge.lnk")) {
        Remove-Item $lnk -Force -ErrorAction SilentlyContinue
    }
    if ($code -eq 532) {
        throw 'Edge refused (exit 532): its uninstaller only runs when started from Settings or Control Panel. Remove it once as admin: Settings > Apps > Installed apps > Microsoft Edge > Uninstall.'
    }
    if (Test-Path $EdgeExe) { throw 'msedge.exe is still there after the uninstaller finished' }
    New-Item -ItemType File -Path $EdgeRemovedMark -Force | Out-Null
    Write-Log '  Edge removed'
}

function Set-AutoLogon {
    if (Test-Path (Join-Path $Root 'no-autologon')) { Write-Log '  autologon disabled by admin (no-autologon file)'; return }
    if (-not (Get-LocalUser -Name 'tv' -ErrorAction SilentlyContinue)) { Write-Log '  tv account does not exist yet'; return }
    $k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    Set-ItemProperty $k -Name AutoAdminLogon -Value '1'
    Set-ItemProperty $k -Name DefaultUserName -Value 'tv'
    Set-ItemProperty $k -Name DefaultDomainName -Value $env:COMPUTERNAME
    Set-ItemProperty $k -Name DefaultPassword -Value ''
    Remove-ItemProperty $k -Name AutoLogonCount -ErrorAction SilentlyContinue
}
