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
    try { & $Body; Write-Log "OK    $Name" }
    catch { Write-Log "FAIL  $Name : $($_.Exception.Message)" }
}

function Invoke-Native([string]$File, [string[]]$Arguments) {
    $p = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru -NoNewWindow
    Write-Log "  $([IO.Path]::GetFileName($File)) $($Arguments -join ' ') -> exit $($p.ExitCode)"
    return $p.ExitCode
}

# Edge's own uninstaller. Microsoft allows it when the device region is in
# the EEA (Digital Markets Act), which is why setup sets the region to
# EEA region first. WebView2 is a separate runtime and is left alone.
function Remove-Edge {
    $setup = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\*\Installer\setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $setup) { Write-Log '  Edge is not installed'; return }
    Invoke-Native $setup.FullName @('--uninstall', '--system-level', '--force-uninstall', '--delete-profile') | Out-Null
    $left = Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    Write-Log "  msedge.exe still present: $left"
    foreach ($lnk in @("$env:PUBLIC\Desktop\Microsoft Edge.lnk",
                       "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Microsoft Edge.lnk")) {
        Remove-Item $lnk -Force -ErrorAction SilentlyContinue
    }
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
