# WinTV admin broker, as SYSTEM: the machine jobs of Settings > Admin,
# behind the admin password (D-39). Started by the task \WinTV\AdminBroker,
# which the TV account may start but not change, with no arguments. WinTV
# starts it when the Admin section opens; it ends after 10 minutes without a
# request.
#
# WinTV talks to it over a named pipe with a new random name. The broker
# creates the pipe first and then writes the name to
# C:\ProgramData\WinTV\state\admin-broker.json, which only SYSTEM and admins
# can write and only they and the tv account can read. So no other account
# can pose as the broker and collect the password, even with a name left
# behind by a crash. The pipe keeps its one instance for the broker's whole
# life (a second can't be added), only the tv account may connect, and only
# WinTV.exe from Program Files\WinTV\versions gets an answer.
#
# One request per connection, one JSON line each way:
#   {"op":"status"}                       -> {"admin":"admin","lockedMinutes":0}
#   {"op":"unlock","password":"..."}      -> {"key":"<64 hex>"}       Windows checks the password
#   {"op":"lock","key":"..."}
#   {"op":"device.get","key":"..."}       -> {"name":"WINTV","pending":null}
#   {"op":"device.rename","key":"...","name":"LIVINGROOM"}            applies at the next restart
#   {"op":"encryption.get","key":"..."}   -> {"state":"off","percent":0}
# Answers are {"ok":true,"result":...} or {"ok":false,"error":"...","locked":true?}.
# Every job but status and unlock needs the key, which lasts 10 minutes from
# its last use. Five wrong passwords in a row: no unlocking for 15 minutes,
# also across restarts. The password is never written anywhere; the log
# names the jobs only.
. "$PSScriptRoot\common.ps1"
$Stage = 'admin'
$ErrorActionPreference = 'Stop'
$StateDir = Join-Path $Root 'state'
$InfoFile = Join-Path $StateDir 'admin-broker.json'
$LockoutFile = Join-Path $StateDir 'admin-lockout.json'
$AdminName = 'admin'          # the account setup creates (autounattend.xml)
$IdleMinutes = 10
$KeyMinutes = 10
$MaxTries = 5
$LockoutMinutes = 15
$MaxRequest = 4096            # bytes; a longer request is dropped
$ShellDir = (Join-Path $env:ProgramFiles 'WinTV\versions') + '\'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
namespace WinTV {
public static class Broker {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool LogonUser(string user, string domain, string password, int type, int provider, out IntPtr token);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);
    // The name the PC takes at its next restart (5 = physical DNS host name,
    // which sets the NetBIOS name too). The current name undoes a pending one.
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool SetComputerNameEx(int type, string name);
    // The SID of the local account this password signs in, or null. A check
    // only: the logon token is closed at once, nothing runs as that account.
    public static string SignsIn(string user, string password) {
        IntPtr t;
        if (!LogonUser(user, ".", password, 2 /* interactive */, 0, out t)) return null;
        try { using (var id = new WindowsIdentity(t)) return id.User.Value; }
        finally { CloseHandle(t); }
    }
    // Compares two keys in the same time whatever they hold.
    public static bool Same(string a, string b) {
        if (a == null || b == null || a.Length != b.Length) return false;
        int d = 0;
        for (int i = 0; i < a.Length; i++) d |= a[i] ^ b[i];
        return d == 0;
    }
}
}
'@

function New-Hex([int]$Bytes) {
    $b = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($b) } finally { $rng.Dispose() }
    -join ($b | ForEach-Object { $_.ToString('x2') })
}

# Whole file at once, no BOM, so WinTV never reads half a file.
function Save-Json([string]$Path, $Object) {
    New-Item -ItemType Directory -Path (Split-Path $Path) -Force | Out-Null
    $tmp = "$Path.tmp"
    [IO.File]::WriteAllText($tmp, ($Object | ConvertTo-Json -Depth 4 -Compress), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

# Like Save-Json, but only SYSTEM, admins and $Reader may read the file, from
# the moment it exists. For the pipe's name: in a folder every account may
# read, a name left behind by a crash would let another account create that
# pipe and collect the password.
function Save-Private([string]$Path, $Object, [Security.Principal.SecurityIdentifier]$Reader) {
    New-Item -ItemType Directory -Path (Split-Path $Path) -Force | Out-Null
    $tmp = "$Path.tmp"
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue   # security only applies to a new file
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in 'S-1-5-18', 'S-1-5-32-544') {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(([Security.Principal.SecurityIdentifier]$sid), 'FullControl', 'Allow')))
    }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($Reader, 'Read', 'Allow')))
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Object | ConvertTo-Json -Depth 4 -Compress))
    $fs = [IO.File]::Create($tmp, 4096, [IO.FileOptions]::None, $acl)
    try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

# ---------------------------------------------------------------- lockout
function Get-Lockout {
    try { $l = Get-Content -LiteralPath $LockoutFile -Raw | ConvertFrom-Json } catch { $l = $null }
    $until = [datetime]::MinValue
    if ($l -and $l.until -is [datetime]) { $until = $l.until.ToUniversalTime() }
    elseif ($l -and $l.until) { $until = [datetime]::Parse($l.until, [Globalization.CultureInfo]::InvariantCulture, 'RoundtripKind').ToUniversalTime() }
    @{ fails = [int]$(if ($l) { $l.fails } else { 0 }); until = $until }
}
function Get-LockedMinutes {
    $left = ((Get-Lockout).until - (Get-Date).ToUniversalTime()).TotalMinutes
    if ($left -gt 0) { [math]::Ceiling($left) } else { 0 }
}
function Add-Failure {
    $l = Get-Lockout
    $fails = $l.fails + 1
    if ($fails -ge $MaxTries) { Save-Json $LockoutFile @{ fails = 0; until = (Get-Date).ToUniversalTime().AddMinutes($LockoutMinutes).ToString('o') } }
    else { Save-Json $LockoutFile @{ fails = $fails; until = $null } }
}

# ---------------------------------------------------------------- the admin account
function Test-IsAdmin([string]$Sid) {
    # ADSI, not Get-LocalGroupMember: that one fails on any orphaned member.
    $group = ([Security.Principal.SecurityIdentifier]'S-1-5-32-544').Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
    foreach ($m in @(([ADSI]"WinNT://./$group,group").Invoke('Members'))) {
        $bytes = $m.GetType().InvokeMember('objectSid', 'GetProperty', $null, $m, $null)
        if ((New-Object Security.Principal.SecurityIdentifier($bytes, 0)).Value -eq $Sid) { return $true }
    }
    $false
}

$script:Key = $null
$script:KeyUntil = [datetime]::MinValue

function Test-Key($Req) {
    if (-not $script:Key -or (Get-Date) -gt $script:KeyUntil) { $script:Key = $null; return $false }
    if (-not ($Req.key -is [string]) -or -not [WinTV.Broker]::Same($Req.key, $script:Key)) { return $false }
    $script:KeyUntil = (Get-Date).AddMinutes($KeyMinutes)
    $true
}

function Invoke-Unlock($Req) {
    $minutes = Get-LockedMinutes
    if ($minutes -gt 0) { return @{ ok = $false; error = "Too many wrong passwords. Try again in $minutes min."; lockedMinutes = $minutes } }
    if (-not ($Req.password -is [string]) -or $Req.password.Length -lt 1 -or $Req.password.Length -gt 256) { return @{ ok = $false; error = 'bad argument' } }
    $user = Get-LocalUser -Name $AdminName -ErrorAction SilentlyContinue
    if (-not $user -or -not $user.Enabled) { return @{ ok = $false; error = "This PC has no '$AdminName' account" } }
    $sid = [WinTV.Broker]::SignsIn($AdminName, $Req.password)
    if ($sid -ne $user.SID.Value) {
        Add-Failure
        $minutes = Get-LockedMinutes
        if ($minutes -gt 0) { return @{ ok = $false; error = "Too many wrong passwords. Try again in $minutes min."; lockedMinutes = $minutes } }
        return @{ ok = $false; error = "That isn't the admin password" }
    }
    if (-not (Test-IsAdmin $sid)) { return @{ ok = $false; error = "'$AdminName' is no longer an administrator" } }
    Save-Json $LockoutFile @{ fails = 0; until = $null }
    $script:Key = New-Hex 32
    $script:KeyUntil = (Get-Date).AddMinutes($KeyMinutes)
    @{ ok = $true; result = @{ key = $script:Key } }
}

# ---------------------------------------------------------------- jobs
$NamePattern = '^(?![0-9]+$)(?!-)[A-Za-z0-9-]{1,15}(?<!-)$'   # what Windows accepts as a PC name

function Get-DeviceName {
    $next = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName').ComputerName
    $now = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName').ComputerName
    @{ name = $now; pending = $(if ($next -ne $now) { $next } else { $null }) }
}

function Get-Encryption {
    if (-not (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) { return @{ state = 'unavailable'; percent = 0 } }
    $v = Get-BitLockerVolume -MountPoint $env:SystemDrive
    $state = switch ([string]$v.VolumeStatus) {
        'FullyDecrypted' { 'off' }
        'FullyEncrypted' { if ([string]$v.ProtectionStatus -eq 'On') { 'on' } else { 'suspended' } }
        'EncryptionInProgress' { 'encrypting' }
        'DecryptionInProgress' { 'decrypting' }
        default { 'other' }
    }
    @{ state = $state; percent = [int]$v.EncryptionPercentage }
}

function Invoke-Request($Req) {
    $op = [string]$Req.op
    if ($op -eq 'status') { return @{ ok = $true; result = @{ admin = $AdminName; lockedMinutes = (Get-LockedMinutes) } } }
    if ($op -eq 'unlock') { return Invoke-Unlock $Req }
    if ($op -notin 'lock', 'device.get', 'device.rename', 'encryption.get') { return @{ ok = $false; error = 'Unknown job' } }
    if (-not (Test-Key $Req)) { return @{ ok = $false; error = 'Locked'; locked = $true } }
    switch ($op) {
        'lock' { $script:Key = $null; return @{ ok = $true; result = @{} } }
        'device.get' { return @{ ok = $true; result = (Get-DeviceName) } }
        'device.rename' {
            $name = [string]$Req.name
            if ($name -notmatch $NamePattern) { return @{ ok = $false; error = 'Use up to 15 letters, digits and hyphens' } }
            # Not Rename-Computer: it skips a name equal to the current one, so a
            # pending rename could never be taken back.
            if (-not [WinTV.Broker]::SetComputerNameEx(5, $name)) { return @{ ok = $false; error = 'Windows refused that name' } }
            return @{ ok = $true; result = (Get-DeviceName) }
        }
        'encryption.get' { return @{ ok = $true; result = (Get-Encryption) } }
    }
}

# ---------------------------------------------------------------- the pipe
function Test-Client([IO.Pipes.NamedPipeServerStream]$Pipe) {
    [uint32]$id = 0
    if (-not [WinTV.Broker]::GetNamedPipeClientProcessId($Pipe.SafePipeHandle.DangerousGetHandle(), [ref]$id)) { return $false }
    $exe = (Get-Process -Id $id -ErrorAction SilentlyContinue).Path
    if (-not $exe) { return $false }
    $exe = [IO.Path]::GetFullPath($exe)
    $exe.StartsWith($ShellDir, [StringComparison]::OrdinalIgnoreCase) -and ([IO.Path]::GetFileName($exe) -eq 'WinTV.exe')
}

# Reads one line of at most $MaxRequest bytes within 5 seconds, or $null.
function Read-Request([IO.Pipes.NamedPipeServerStream]$Pipe) {
    $buf = New-Object byte[] $MaxRequest
    $have = 0
    $deadline = (Get-Date).AddSeconds(5)
    while ($have -lt $MaxRequest) {
        $t = $Pipe.ReadAsync($buf, $have, $MaxRequest - $have)
        $wait = [int][math]::Max(0, ($deadline - (Get-Date)).TotalMilliseconds)
        if (-not $t.Wait($wait)) { return $null }
        if ($t.Result -le 0) { return $null }
        $have += $t.Result
        $nl = [Array]::IndexOf($buf, [byte]10, 0, $have)
        if ($nl -ge 0) { return [Text.Encoding]::UTF8.GetString($buf, 0, $nl) }
    }
    $null
}

function Write-Answer([IO.Pipes.NamedPipeServerStream]$Pipe, $Answer) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Answer | ConvertTo-Json -Depth 4 -Compress) + "`n")
    $Pipe.Write($bytes, 0, $bytes.Length)
    $Pipe.Flush()
    $Pipe.WaitForPipeDrain()
}

$tv = Get-LocalUser -Name tv
$security = New-Object IO.Pipes.PipeSecurity
$security.AddAccessRule((New-Object IO.Pipes.PipeAccessRule(([Security.Principal.SecurityIdentifier]'S-1-5-18'), 'FullControl', 'Allow')))
# Node opens pipes for reading and writing, which Windows counts as also
# asking for "new instance"; the one-instance limit is what stops a second one.
$security.AddAccessRule((New-Object IO.Pipes.PipeAccessRule($tv.SID, 'ReadWrite, CreateNewInstance, Synchronize', 'Allow')))
$name = 'WinTV.Admin.' + (New-Hex 16)
$pipe = New-Object IO.Pipes.NamedPipeServerStream($name, 'InOut', 1, 'Byte', 'Asynchronous', 4096, 4096, $security)
Save-Private $InfoFile @{ pipe = $name; pid = $PID; started = (Get-Date).ToString('o') } $tv.SID
Write-Log "broker up (pid $PID)"

$lastUsed = Get-Date
try {
    while ($true) {
        $wait = $pipe.WaitForConnectionAsync()
        while (-not $wait.Wait(15000)) {
            if (((Get-Date) - $lastUsed).TotalMinutes -ge $IdleMinutes) { Write-Log 'idle: broker stops'; return }
        }
        try {
            if (-not (Test-Client $pipe)) { Write-Log 'refused a client that is not WinTV'; continue }
            $line = Read-Request $pipe
            if ($null -eq $line) { continue }
            try { $req = $line | ConvertFrom-Json } catch { $req = $null }
            if (-not $req -or -not ($req.op -is [string])) { Write-Answer $pipe @{ ok = $false; error = 'bad request' }; continue }
            $lastUsed = Get-Date
            $op = $req.op
            try { $answer = Invoke-Request $req } catch { $answer = @{ ok = $false; error = $_.Exception.Message } }
            $req = $null; $line = $null   # the password, if there was one
            Write-Log "$($op): $(if ($answer.ok) { 'ok' } else { $answer.error })"
            Write-Answer $pipe $answer
        } catch {
            Write-Log "connection: $($_.Exception.Message)"
        } finally {
            if ($pipe.IsConnected) { $pipe.Disconnect() }
        }
    }
} finally {
    $pipe.Dispose()
    if ((Get-Content -LiteralPath $InfoFile -Raw -ErrorAction SilentlyContinue) -match [regex]::Escape($name)) { Remove-Item -LiteralPath $InfoFile -Force }
}
