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

# A scheduled task that runs a WinTV script as SYSTEM. With -UsersMayStart,
# local users may *start* it (read + execute in the task's security
# descriptor) but not change it, and it takes no input from them (D-27).
function Register-WinTVTask {
    param([string]$Name, [string]$Script, [string]$Arguments = '', [string[]]$Triggers = @(),
          [string]$Description, [switch]$UsersMayStart)
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    try { $folder = $svc.GetFolder('\WinTV') } catch { $folder = $svc.GetFolder('\').CreateFolder('WinTV') }
    $def = $svc.NewTask(0)
    $def.RegistrationInfo.Description = $Description
    $set = $def.Settings
    $set.MultipleInstances = 2            # a second start while running is ignored
    $set.DisallowStartIfOnBatteries = $false
    $set.StopIfGoingOnBatteries = $false
    $set.StartWhenAvailable = $true
    $set.ExecutionTimeLimit = 'PT4H'
    $def.Principal.UserId = 'SYSTEM'
    $def.Principal.LogonType = 5          # service account
    $def.Principal.RunLevel = 1           # highest
    foreach ($t in $Triggers) {
        if ($t -eq 'boot') { $tr = $def.Triggers.Create(8); $tr.Delay = 'PT5M' }
        elseif ($t -eq 'daily') {
            $tr = $def.Triggers.Create(2)
            $tr.StartBoundary = (Get-Date -Hour 4 -Minute 0 -Second 0).ToString('s')
            $tr.DaysInterval = 1
            $tr.RandomDelay = 'PT1H'
        }
        elseif ($t -eq 'signout') {
            # Right after anyone signs out: Winlogon's event 7002 in the System log.
            $tr = $def.Triggers.Create(0)
            $tr.Subscription = '<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name=''Microsoft-Windows-Winlogon''] and EventID=7002]]</Select></Query></QueryList>'
        }
        elseif ($t -eq 'online') {
            # A network connected: NetworkProfile's event 10000. A minute later,
            # so the name servers answer.
            $tr = $def.Triggers.Create(0)
            $tr.Subscription = '<QueryList><Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"><Select Path="Microsoft-Windows-NetworkProfile/Operational">*[System[Provider[@Name=''Microsoft-Windows-NetworkProfile''] and EventID=10000]]</Select></Query></QueryList>'
            $tr.Delay = 'PT1M'
        }
    }
    $act = $def.Actions.Create(0)
    $act.Path = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $act.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Payload\setup\$Script`" $Arguments".Trim()
    $sddl = 'D:(A;;FA;;;SY)(A;;FA;;;BA)'
    if ($UsersMayStart) { $sddl += '(A;;GRGX;;;BU)' }
    [void]$folder.RegisterTaskDefinition($Name, $def, 6, 'SYSTEM', $null, 5, $sddl)
}

# Every update task, as setup and each release register them.
function Register-UpdateTasks {
    Register-WinTVTask -Name 'WindowsUpdateCheck' -Script 'updates.ps1' -Arguments '-Job windows-check' -Triggers boot, daily `
        -Description 'WinTV: check Windows Update for the TV''s Updates screen.' -UsersMayStart
    Register-WinTVTask -Name 'WindowsUpdateInstall' -Script 'updates.ps1' -Arguments '-Job windows-install' `
        -Description 'WinTV: install the updates Windows would install by itself, now (Settings > Updates).' -UsersMayStart
    Register-WinTVTask -Name 'WinTVUpdate' -Script 'updates.ps1' -Arguments '-Job wintv' -Triggers boot, daily `
        -Description 'WinTV: install a newer signed WinTV release, or roll back one that does not start.' -UsersMayStart
    Register-UpdatesOnlineTask
}

# When a network connects, the two checks above start at once (D-48).
function Register-UpdatesOnlineTask {
    Register-WinTVTask -Name 'UpdatesOnline' -Script 'updates.ps1' -Arguments '-Job online' -Triggers online `
        -Description 'WinTV: when a network connects, check for Windows and WinTV updates at once (at most every 30 minutes).'
}

# Settings > Admin's broker (D-39): the TV account may start it, not change
# it, and it takes no arguments. It ends by itself after 10 idle minutes.
# BackToTV puts the TV back on the screen when the admin signs out of the
# Windows desktop (D-41).
function Register-AdminTask {
    Register-WinTVTask -Name 'AdminBroker' -Script 'admin.ps1' `
        -Description 'WinTV: the jobs of Settings > Admin, behind the admin password. Stops after 10 idle minutes.' -UsersMayStart
    Register-WinTVTask -Name 'BackToTV' -Script 'back-to-tv.ps1' -Triggers signout `
        -Description 'WinTV: after the admin signs out of the Windows desktop, the TV comes back on the screen.'
}

# The tv account's Shell value names the supervisor of the version in
# current.json, so the next sign-in starts it. If that file were missing,
# Windows would quietly start Explorer instead: the Windows desktop on the TV.
function Set-TvShell([string]$Version) {
    $sid = (Get-LocalUser -Name tv -ErrorAction SilentlyContinue).SID.Value
    if (-not $sid) { return }
    $value = "`"$env:ProgramFiles\WinTV\versions\$Version\WinTV.exe`" --supervise"
    $loaded = Test-Path "Registry::HKEY_USERS\$sid"
    $hive = Join-Path (Split-Path $env:PUBLIC) 'tv\NTUSER.DAT'
    # The boot task of a new install runs before tv has ever signed in: no
    # profile yet, and firstlogon.ps1 sets the shell at that first sign-in.
    if (-not $loaded -and -not (Test-Path $hive)) { Write-Log '  tv has not signed in yet; its first sign-in sets the shell'; return }
    if (-not $loaded) { Invoke-Native "$env:SystemRoot\System32\reg.exe" @('load', "HKU\$sid", $hive) | Out-Null }
    try {
        $k = "Registry::HKEY_USERS\$sid\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
        if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
        Set-ItemProperty $k -Name Shell -Value $value
    } finally {
        if (-not $loaded) { [gc]::Collect(); Invoke-Native "$env:SystemRoot\System32\reg.exe" @('unload', "HKU\$sid") | Out-Null }
    }
}
