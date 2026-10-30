# WinTV VM check: run inside VM 222 as SYSTEM via gx.sh "$(cat verify.ps1)".
$ErrorActionPreference = 'Continue'
$tv = Get-CimInstance Win32_UserAccount -Filter "LocalAccount=True AND Name='tv'"
$r = [ordered]@{}
$r.setupFailures = @(Select-String -Path C:\ProgramData\WinTV\setup.log -Pattern ' FAIL ' | ForEach-Object { $_.Line })
$r.deviceRegion = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Control Panel\DeviceRegion' -ErrorAction SilentlyContinue).DeviceRegion
$r.edgeInstalled = Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$r.webView2 = Test-Path "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application"
$r.braveSystemWide = Test-Path "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
$r.provisionedApps = @((Get-AppxProvisionedPackage -Online).DisplayName | Sort-Object)
$r.storeForTv = [bool](Get-AppxPackage -AllUsers -Name Microsoft.WindowsStore | Where-Object { $_.PackageUserInformation.UserSecurityId.Sid -contains $tv.SID })
$r.bitLocker = (Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue | ForEach-Object { "$($_.VolumeStatus) / $($_.ProtectionStatus)" })
$r.tvShell = (Get-ItemProperty "Registry::HKEY_USERS\$($tv.SID)\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" -ErrorAction SilentlyContinue).Shell
$r.processes = @(Get-Process -IncludeUserName -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in 'WinTV', 'brave', 'explorer', 'qemu-ga' } |
    Group-Object ProcessName, UserName | ForEach-Object { "$($_.Name) x$($_.Count)" })
$r.firstLogon = @(Get-Content C:\Users\tv\AppData\Local\WinTV\firstlogon.log -ErrorAction SilentlyContinue | ForEach-Object { "$_" })
$r.shellLog = @(Get-Content C:\Users\tv\AppData\Roaming\WinTV\shell.log -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { "$_" })
$r | ConvertTo-Json -Depth 4
