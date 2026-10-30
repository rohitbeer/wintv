# WinTV, specialize pass. Runs once as SYSTEM, before any user exists.
# Turns stock Windows 11 into the TV appliance. Log: C:\ProgramData\WinTV\setup.log
. "$PSScriptRoot\common.ps1"
$Stage = 'specialize'
$Config = Get-Content (Join-Path $Payload 'build.json') -Raw | ConvertFrom-Json
Write-Log "WinTV $($Config.version) variant=$($Config.variant) built=$($Config.built)"

Invoke-Step 'remove provisioned apps (allow-list)' {
    $keep = Get-Content "$PSScriptRoot\keep-apps.txt" | Where-Object { $_ -and -not $_.StartsWith('#') }
    foreach ($pkg in Get-AppxProvisionedPackage -Online) {
        $name = $pkg.DisplayName
        if ($keep | Where-Object { $name -match $_ }) { Write-Log "  keep    $name"; continue }
        try {
            Remove-AppxProvisionedPackage -Online -PackageName $pkg.PackageName -AllUsers -ErrorAction Stop | Out-Null
            Write-Log "  removed $name"
        } catch { Write-Log "  FAILED  $name : $($_.Exception.Message)" }
    }
}

Invoke-Step 'machine policies' {
    Invoke-Native "$env:SystemRoot\System32\reg.exe" @('import', "$PSScriptRoot\policies.reg") | Out-Null
}

Invoke-Step 'default user profile (every new account starts clean)' {
    $hive = 'HKU\WinTVDefault'
    Invoke-Native "$env:SystemRoot\System32\reg.exe" @('load', $hive, 'C:\Users\Default\NTUSER.DAT') | Out-Null
    try {
        Invoke-Native "$env:SystemRoot\System32\reg.exe" @('import', "$PSScriptRoot\default-user.reg") | Out-Null
        # First logon of each new account runs firstlogon.ps1; it only acts for tv.
        Invoke-Native "$env:SystemRoot\System32\reg.exe" @('add', "$hive\Software\Microsoft\Windows\CurrentVersion\RunOnce",
            '/v', 'WinTV', '/t', 'REG_SZ', '/f', '/d',
            "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Payload\setup\firstlogon.ps1`"") | Out-Null
    } finally {
        [gc]::Collect()
        Invoke-Native "$env:SystemRoot\System32\reg.exe" @('unload', $hive) | Out-Null
    }
}

Invoke-Step 'uninstall Microsoft Edge' { Remove-Edge }

Invoke-Step 'install browser' {
    $installer = Get-ChildItem (Join-Path $Payload 'apps') -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    $msi = Get-ChildItem (Join-Path $Payload 'apps') -Filter *.msi -ErrorAction SilentlyContinue | Select-Object -First 1
    $file = if ($installer) { $installer } else { $msi }
    if (-not $file) { throw 'no browser installer in payload\apps' }
    # Only run it if the vendor's signature checks out.
    $sig = Get-AuthenticodeSignature $file.FullName
    Write-Log "  $($file.Name): signature $($sig.Status), $($sig.SignerCertificate.Subject)"
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch $Config.browserSigner) {
        throw "refusing $($file.Name): signature is not a valid '$($Config.browserSigner)' signature"
    }
    if ($file.Extension -eq '.msi') {
        Invoke-Native "$env:SystemRoot\System32\msiexec.exe" @('/i', $file.FullName, '/qn', '/norestart') -OkCodes @(0, 3010) | Out-Null
    } else {
        # Brave's installer: no window, install now. Run as SYSTEM it installs
        # for every account, with its updater.
        Invoke-Native $file.FullName @('/silent', '/install') | Out-Null
    }
    $exe = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
    if (-not (Test-Path $exe)) { throw "brave.exe is not in Program Files after install" }
    Write-Log "  $exe"
}

Invoke-Step 'default browser for new accounts' {
    Invoke-Native "$env:SystemRoot\System32\dism.exe" @('/Online', "/Import-DefaultAppAssociations:$PSScriptRoot\associations.xml") | Out-Null
}

Invoke-Step 'install the WinTV shell' {
    $dest = "$env:ProgramFiles\WinTV"
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Copy-Item -Path (Join-Path $Payload 'shell\*') -Destination $dest -Recurse -Force
    if (-not (Test-Path "$dest\WinTV.exe")) { throw 'WinTV.exe missing after copy' }
    $site = Join-Path $Payload 'config\apps.json'
    if (Test-Path $site) { Copy-Item $site (Join-Path $Root 'apps.json') -Force; Write-Log '  site config installed' }
}

Invoke-Step 'optional features: Recall off' {
    # Only Copilot+ PCs have Recall as a feature; elsewhere there is nothing to turn off.
    $recall = Get-WindowsOptionalFeature -Online -FeatureName Recall -ErrorAction SilentlyContinue
    if (-not $recall -or $recall.State -eq 'Disabled') { Write-Log '  Recall not present or already off'; return }
    # 3010 = done, restart needed (setup restarts anyway).
    Invoke-Native "$env:SystemRoot\System32\dism.exe" @('/Online', '/Disable-Feature', '/FeatureName:Recall', '/NoRestart', '/Quiet') -OkCodes @(0, 3010) | Out-Null
}

Invoke-Step 'services: telemetry off' {
    foreach ($svc in 'DiagTrack', 'dmwappushservice') {
        if (Get-Service $svc -ErrorAction SilentlyContinue) { Set-Service $svc -StartupType Disabled; Write-Log "  $svc disabled" }
    }
}

Invoke-Step 'power and boot: quiet, straight to the TV' {
    Invoke-Native "$env:SystemRoot\System32\powercfg.exe" @('/hibernate', 'off') | Out-Null
    # Screen off after 30 idle minutes, sleep after 60 (plugged in; half that
    # on battery). The shell's lock screen comes first, after 5 minutes.
    foreach ($t in @(@('monitor-timeout-ac', 30), @('standby-timeout-ac', 60), @('monitor-timeout-dc', 15), @('standby-timeout-dc', 30))) {
        Invoke-Native "$env:SystemRoot\System32\powercfg.exe" @('/change', $t[0], [string]$t[1]) | Out-Null
    }
    # No password prompt when the TV wakes up (tv has no password anyway).
    Invoke-Native "$env:SystemRoot\System32\powercfg.exe" @('/SETACVALUEINDEX', 'SCHEME_CURRENT', 'SUB_NONE', 'CONSOLELOCK', '0') | Out-Null
    Invoke-Native "$env:SystemRoot\System32\powercfg.exe" @('/SETDCVALUEINDEX', 'SCHEME_CURRENT', 'SUB_NONE', 'CONSOLELOCK', '0') | Out-Null
    # Boot without the Windows logo, spinner and text; the firmware logo stays.
    foreach ($opt in 'custom:16000067', 'custom:16000068', 'custom:16000069') {
        Invoke-Native "$env:SystemRoot\System32\bcdedit.exe" @('/set', '{globalsettings}', $opt, 'true') | Out-Null
    }
}

Invoke-Step 'boot task + SetupComplete' {
    Invoke-Native "$env:SystemRoot\System32\schtasks.exe" @('/Create', '/F', '/TN', 'WinTV\Maintain', '/RU', 'SYSTEM',
        '/SC', 'ONSTART', '/RL', 'HIGHEST', '/TR',
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Payload\setup\maintain.ps1`"") | Out-Null
    $scripts = "$env:SystemRoot\Setup\Scripts"
    New-Item -ItemType Directory -Path $scripts -Force | Out-Null
    Copy-Item "$PSScriptRoot\SetupComplete.cmd" "$scripts\SetupComplete.cmd" -Force
}

if ($Config.variant -eq 'usb') {
    Invoke-Step 'activation: use the key in the PC firmware, if any' {
        $oa3 = (Get-CimInstance SoftwareLicensingService).OA3xOriginalProductKey
        if ($oa3) {
            Invoke-Native "$env:SystemRoot\System32\cscript.exe" @('//nologo', "$env:SystemRoot\System32\slmgr.vbs", '/ipk', $oa3) | Out-Null
        } else { Write-Log '  no firmware key; Windows stays unactivated until a key is entered' }
    }
}

if ($Config.variant -eq 'vm') {
    Invoke-Step 'VM test tooling: virtio-serial driver' {
        $t = Join-Path $Payload 'test'
        # pnputil: 3010 = installed, restart needed; 259 = staged, no device updated yet.
        Invoke-Native "$env:SystemRoot\System32\pnputil.exe" @('/add-driver', "$t\vioserial\vioser.inf", '/install') -OkCodes @(0, 259, 3010) | Out-Null
        Invoke-Native "$env:SystemRoot\System32\pnputil.exe" @('/add-driver', "$t\viogpudo\viogpudo.inf", '/install') -OkCodes @(0, 259, 3010) | Out-Null
        # The agent itself is installed by setupcomplete.ps1.
    }
}

Invoke-Step 'lock down C:\ProgramData\WinTV (SYSTEM runs scripts from here)' {
    # Admins and SYSTEM may change it; everyone else may only read it. Without
    # this, any user could edit maintain.ps1 and run code as SYSTEM.
    Invoke-Native "$env:SystemRoot\System32\icacls.exe" @($Root, '/inheritance:r', '/grant:r',
        '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX', '/C', '/Q') | Out-Null
}

Write-Log 'specialize done'
