# WinTV, after Windows setup has finished and before anyone signs in (SYSTEM).
. "$PSScriptRoot\common.ps1"
$Stage = 'setupcomplete'
$Config = Get-Content (Join-Path $Payload 'build.json') -Raw | ConvertFrom-Json

# Setup's own autologon expires after one sign-in; make it permanent for tv.
Invoke-Step 'permanent autologon for tv' { Set-AutoLogon }

if ($Config.variant -eq 'vm') {
    Invoke-Step 'VM test tooling: QEMU guest agent' {
        # Here, not in specialize: its backup (VSS) part registers with the
        # shadow copy service, which is not available during specialize. The
        # first VM run failed there with error 1722.
        $t = Join-Path $Payload 'test'
        Invoke-Native "$env:SystemRoot\System32\msiexec.exe" @('/i', "$t\qemu-ga-x86_64.msi", '/qn', '/norestart',
            '/l*v', (Join-Path $Root 'qemu-ga-install.log')) -OkCodes @(0, 3010) | Out-Null
    }
}
