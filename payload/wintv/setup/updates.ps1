# WinTV updates, as SYSTEM. Started by three scheduled tasks that the TV
# account may *start* but not change, and that take no input (D-27, D-28):
#   \WinTV\WindowsUpdateCheck     -Job windows-check    (also at boot and daily)
#   \WinTV\WindowsUpdateInstall   -Job windows-install  (the TV's "Install now")
#   \WinTV\WinTVUpdate            -Job wintv            (also at boot and daily)
# Progress goes to C:\ProgramData\WinTV\state\*.json, which the shell reads.
param([Parameter(Mandatory)][ValidateSet('windows-check', 'windows-install', 'wintv')][string]$Job)
. "$PSScriptRoot\common.ps1"
$Stage = "updates/$Job"
$StateDir = Join-Path $Root 'state'
$WinTVDir = "$env:ProgramFiles\WinTV"
$Versions = Join-Path $WinTVDir 'versions'
$CurrentFile = Join-Path $WinTVDir 'current.json'
$ReleaseSource = 'https://github.com/rohitbeer/wintv/releases/latest/download/'
$TvAppData = Join-Path (Split-Path $env:PUBLIC) 'tv\AppData\Roaming\WinTV'

# Whole file at once, no BOM, so the shell never reads half a file.
function Save-Json([string]$Path, $Object) {
    New-Item -ItemType Directory -Path (Split-Path $Path) -Force | Out-Null
    $tmp = "$Path.tmp"
    [IO.File]::WriteAllText($tmp, ($Object | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Read-Json([string]$Path) {
    if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } else { $null }
}
function Save-State([string]$Name, [hashtable]$State) {
    $State.updated = (Get-Date).ToString('o')
    Save-Json (Join-Path $StateDir "$Name.json") $State
}

# ---------------------------------------------------------------- Windows Update
# Exactly what Windows would install by itself (the updates it selects
# automatically), only now. Nothing is hidden or removed.
$Criteria = "IsInstalled=0 and IsHidden=0 and AutoSelectOnWebSites=1"

function Get-LastInstall {
    try {
        $d = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastInstallationSuccessDate
        if ($d -and $d.Year -gt 2000) { return $d.ToString('o') }
    } catch { }
    return $null
}
function Test-RebootRequired { try { (New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired } catch { $false } }

function Find-WindowsUpdates {
    $session = New-Object -ComObject Microsoft.Update.Session
    $session.ClientApplicationID = 'WinTV'
    return @{ session = $session; result = $session.CreateUpdateSearcher().Search($Criteria) }
}

function Invoke-WindowsCheck {
    Save-State 'windows-update' @{ state = 'checking'; rebootRequired = (Test-RebootRequired); lastInstall = (Get-LastInstall) }
    $found = Find-WindowsUpdates
    $list = @(foreach ($u in $found.result.Updates) { @{ title = $u.Title; sizeMB = [math]::Ceiling($u.MaxDownloadSize / 1MB) } })
    Save-State 'windows-update' @{ state = 'idle'; checked = (Get-Date).ToString('o'); pending = $list
        rebootRequired = (Test-RebootRequired); lastInstall = (Get-LastInstall) }
    Write-Log "  $($list.Count) update(s) available"
}

function Invoke-WindowsInstall {
    Save-State 'windows-update' @{ state = 'checking' }
    $found = Find-WindowsUpdates
    $updates = @($found.result.Updates | ForEach-Object { $_ })
    $total = $updates.Count
    $done = 0
    $failed = @()
    foreach ($u in $updates) {
        $done += 1
        if (-not $u.EulaAccepted) { $u.AcceptEula() }
        $one = New-Object -ComObject Microsoft.Update.UpdateColl
        [void]$one.Add($u)
        Save-State 'windows-update' @{ state = 'downloading'; step = $done; total = $total; title = $u.Title }
        $dl = $found.session.CreateUpdateDownloader()
        $dl.Updates = $one
        [void]$dl.Download()
        Save-State 'windows-update' @{ state = 'installing'; step = $done; total = $total; title = $u.Title }
        $in = $found.session.CreateUpdateInstaller()
        $in.Updates = $one
        $r = $in.Install()
        # ResultCode 2 = succeeded, 3 = succeeded with errors
        if ($r.ResultCode -notin 2, 3) { $failed += $u.Title; Write-Log "  FAILED $($u.Title) (result $($r.ResultCode))" }
        else { Write-Log "  installed $($u.Title)" }
    }
    Save-State 'windows-update' @{ state = $(if ($failed.Count) { 'failed' } else { 'idle' }); checked = (Get-Date).ToString('o')
        pending = @(); installed = $total - $failed.Count; failedTitles = $failed
        rebootRequired = (Test-RebootRequired); lastInstall = (Get-LastInstall) }
}

# ---------------------------------------------------------------- WinTV itself
# Releases are signed with the project's release key (RSA, SHA-256). The
# public half ships with the setup scripts; a package that doesn't verify,
# isn't newer than what is installed, or was rolled back once is ignored.
function Test-Signature([byte[]]$Data, [byte[]]$Signature) {
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    try {
        $rsa.FromXmlString((Get-Content (Join-Path $PSScriptRoot 'release-key.xml') -Raw))
        return $rsa.VerifyData($Data, 'SHA256', $Signature)
    } finally { $rsa.Dispose() }
}

function Get-Source {
    # Admins may point a machine at another source (a URL, or a folder for
    # tests). The file is in C:\ProgramData\WinTV, which only admins can change.
    $override = Join-Path $Root 'update-source.txt'
    if (Test-Path $override) { return (Get-Content $override -Raw).Trim() }
    return $ReleaseSource
}

function Get-File([string]$Source, [string]$Name, [string]$Dest) {
    if ($Source -match '^https://') {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -UseBasicParsing -Uri ($Source.TrimEnd('/') + '/' + $Name) -OutFile $Dest
    } elseif (Test-Path -LiteralPath $Source -PathType Container) {
        Copy-Item -LiteralPath (Join-Path $Source $Name) -Destination $Dest -Force
    } else { throw "update source '$Source' is neither https nor a folder" }
}

function Set-Current($Current) {
    Save-Json $CurrentFile $Current
    Set-TvShell $Current.version
}

# A new version that crash-loops, or never shows its screen, goes back to
# the previous one. Only within an hour of switching, so this can't be used
# later to force an old version back.
function Test-Rollback($Current) {
    if (-not $Current.previous -or -not $Current.switchedAt) { return $false }
    $since = (Get-Date) - [datetime]$Current.switchedAt
    if ($since.TotalHours -gt 1) { return $false }
    $health = Read-Json (Join-Path $TvAppData 'health.json')
    $crash = Read-Json (Join-Path $TvAppData 'crashloop.json')
    $healthy = $health -and $health.version -eq $Current.version
    $looping = $crash -and $crash.version -eq $Current.version -and [datetime]$crash.at -gt [datetime]$Current.switchedAt
    if ($healthy -and -not $looping) { return $false }
    if (-not $looping -and $since.TotalMinutes -lt 10) { return $false } # still starting up
    Write-Log "  $($Current.version) is not healthy (crash loop: $looping); back to $($Current.previous)"
    $bad = @($Current.bad) + $Current.version | Where-Object { $_ } | Select-Object -Unique
    Set-Current @{ version = $Current.previous; previous = $null; switchedAt = $null; bad = @($bad) }
    return $true
}

function Remove-OldVersions($Current) {
    $keep = @($Current.version, $Current.previous) | Where-Object { $_ }
    $inUse = @(Get-Process WinTV -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } | Where-Object { $_ })
    foreach ($d in Get-ChildItem $Versions -Directory -ErrorAction SilentlyContinue) {
        if ($keep -contains $d.Name) { continue }
        if ($inUse | Where-Object { $_.StartsWith($d.FullName + '\') }) { continue }
        Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "  removed old version $($d.Name)"
    }
}

function Invoke-WinTVUpdate {
    $current = Read-Json $CurrentFile
    if (-not $current) { throw "$CurrentFile missing" }
    if (Test-Rollback $current) { $current = Read-Json $CurrentFile }
    Save-State 'wintv-update' @{ state = 'checking'; current = $current.version }
    $source = Get-Source
    $dl = Join-Path $Root 'download'
    Remove-Item -LiteralPath $dl -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $dl -Force | Out-Null
    Get-File $source 'manifest.json' "$dl\manifest.json"
    Get-File $source 'manifest.sig' "$dl\manifest.sig"
    $bytes = [IO.File]::ReadAllBytes("$dl\manifest.json")
    if (-not (Test-Signature $bytes ([IO.File]::ReadAllBytes("$dl\manifest.sig")))) { throw 'manifest signature does not verify' }
    $m = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    if ($m.name -ne 'wintv' -or $m.version -notmatch '^\d+\.\d+\.\d+$' -or $m.package.file -notmatch '^[\w.-]+\.zip$') { throw 'manifest is malformed' }
    if ([version]$m.version -le [version]$current.version -or @($current.bad) -contains $m.version) {
        Remove-OldVersions $current
        Save-State 'wintv-update' @{ state = 'up-to-date'; current = $current.version; checked = (Get-Date).ToString('o') }
        Write-Log "  up to date ($($current.version); latest $($m.version))"
        return
    }
    Save-State 'wintv-update' @{ state = 'downloading'; current = $current.version; available = $m.version }
    $zip = Join-Path $dl $m.package.file
    Get-File $source $m.package.file $zip
    if ((Get-Item $zip).Length -ne [long]$m.package.size) { throw 'package size does not match the manifest' }
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $m.package.sha256.ToUpper()) { throw 'package hash does not match the manifest' }

    Save-State 'wintv-update' @{ state = 'installing'; current = $current.version; available = $m.version }
    $dest = Join-Path $Versions $m.version
    $partial = "$dest.partial"
    Remove-Item -LiteralPath $partial, $dest -Recurse -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $partial)
    if (-not (Test-Path "$partial\shell\WinTV.exe")) { throw 'package has no shell\WinTV.exe' }
    Move-Item -LiteralPath "$partial\shell" -Destination $dest
    # The setup scripts (this one included) come with each release.
    if (Test-Path "$partial\setup") { Copy-Item "$partial\setup\*" (Join-Path $Payload 'setup') -Recurse -Force }
    Remove-Item -LiteralPath $partial -Recurse -Force

    Set-Current @{ version = $m.version; previous = $current.version; switchedAt = (Get-Date).ToString('o'); bad = @($current.bad) }
    Save-State 'wintv-update' @{ state = 'ready'; current = $current.version; available = $m.version; checked = (Get-Date).ToString('o') }
    Write-Log "  installed $($m.version); the shell switches when nobody is watching"
    Remove-Item -LiteralPath $dl -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- run
# $script: because Invoke-Step's own $Name would win inside the step
# (PowerShell scoping is dynamic).
$script:StateName = if ($Job -eq 'wintv') { 'wintv-update' } else { 'windows-update' }
Invoke-Step "updates: $Job" {
    try {
        switch ($Job) {
            'windows-check' { Invoke-WindowsCheck }
            'windows-install' { Invoke-WindowsInstall }
            'wintv' { Invoke-WinTVUpdate }
        }
    } catch {
        $prev = Read-Json (Join-Path $StateDir "$script:StateName.json")
        Save-State $script:StateName @{ state = 'failed'; error = $_.Exception.Message; current = $(if ($prev) { $prev.current } else { $null }) }
        throw
    }
}
