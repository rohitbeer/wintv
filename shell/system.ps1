# WinTV system helper: the WinTV Settings screens' only way into Windows.
# main.js starts it once, as the tv user, and keeps it running. One JSON
# request per line on stdin, one JSON answer per line on stdout:
#   {"id":1,"op":"display.get"}                    current picture mode + the modes the TV offers
#   {"id":2,"op":"display.set","width":1920,"height":1080,"hz":60}
#   {"id":3,"op":"audio.get"}                      output device, volume 0-100, muted
#   {"id":4,"op":"audio.set","volume":40}          or {"muted":true}
#   {"id":7,"op":"audio.key","key":"up"}           the remote's volume keys: up | down | mute
#   {"id":5,"op":"network.get"}                    connections and their addresses
#   {"id":6,"op":"about"}                          Windows version, updates, uptime
#   {"id":8,"op":"process.find","dir":"C:\\..."}   browser processes using this WinTV profile folder
# Each op reads, or changes only the one setting it is named after. main.js
# checks every argument before it gets here.
$ErrorActionPreference = 'Stop'
# Progress bars would arrive on stderr as XML noise in the shell's log.
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace WinTV {
    // Picture modes, through the same Win32 calls the display settings use.
    public static class Display {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DEVMODE {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
            public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
            public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
            public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
            public short dmLogPixels;
            public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
            public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
        }
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettingsW(string device, int mode, ref DEVMODE dm);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsExW(string device, ref DEVMODE dm, IntPtr hwnd, uint flags, IntPtr param);
        const int ENUM_CURRENT_SETTINGS = -1;
        const uint CDS_UPDATEREGISTRY = 0x1, CDS_TEST = 0x2;
        const int DM_BITSPERPEL = 0x40000, DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;

        static DEVMODE Blank() { var d = new DEVMODE(); d.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); return d; }

        public static int[] Current() {
            var d = Blank();
            return EnumDisplaySettingsW(null, ENUM_CURRENT_SETTINGS, ref d) ? new[] { d.dmPelsWidth, d.dmPelsHeight, d.dmDisplayFrequency } : null;
        }

        public static List<int[]> Modes() {
            var seen = new HashSet<string>();
            var list = new List<int[]>();
            var d = Blank();
            for (int i = 0; EnumDisplaySettingsW(null, i, ref d); i++) {
                if (d.dmBitsPerPel != 32 || d.dmPelsWidth < 1024) continue;
                if (seen.Add(d.dmPelsWidth + "x" + d.dmPelsHeight + "@" + d.dmDisplayFrequency))
                    list.Add(new[] { d.dmPelsWidth, d.dmPelsHeight, d.dmDisplayFrequency });
            }
            list.Sort((a, b) => a[0] != b[0] ? b[0] - a[0] : a[1] != b[1] ? b[1] - a[1] : b[2] - a[2]);
            return list;
        }

        // 0 = done. Windows' DISP_CHANGE codes otherwise; -100 = the TV doesn't offer that mode.
        public static int Set(int width, int height, int hz) {
            var d = Blank();
            for (int i = 0; EnumDisplaySettingsW(null, i, ref d); i++) {
                if (d.dmPelsWidth != width || d.dmPelsHeight != height || d.dmDisplayFrequency != hz || d.dmBitsPerPel != 32) continue;
                d.dmFields = DM_BITSPERPEL | DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
                int test = ChangeDisplaySettingsExW(null, ref d, IntPtr.Zero, CDS_TEST, IntPtr.Zero);
                return test != 0 ? test : ChangeDisplaySettingsExW(null, ref d, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
            }
            return -100;
        }
    }

    // Volume of the default output, through Windows' Core Audio API.
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator { }

    public static class Audio {
        const int eRender = 0, eConsole = 0, CLSCTX_ALL = 23;

        static IAudioEndpointVolume Endpoint(out string id) {
            var devices = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(devices.GetDefaultAudioEndpoint(eRender, eConsole, out device));
            Marshal.ThrowExceptionForHR(device.GetId(out id));
            var iid = typeof(IAudioEndpointVolume).GUID;
            object volume;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out volume));
            return (IAudioEndpointVolume)volume;
        }

        // [device id, volume 0-100, muted 0/1]
        public static object[] Get() {
            string id;
            var v = Endpoint(out id);
            float level; bool muted;
            Marshal.ThrowExceptionForHR(v.GetMasterVolumeLevelScalar(out level));
            Marshal.ThrowExceptionForHR(v.GetMute(out muted));
            return new object[] { id, (int)Math.Round(level * 100), muted };
        }

        public static void SetVolume(int percent) {
            string id; var ctx = Guid.Empty;
            Marshal.ThrowExceptionForHR(Endpoint(out id).SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, percent)) / 100f, ref ctx));
        }

        public static void SetMute(bool muted) {
            string id; var ctx = Guid.Empty;
            Marshal.ThrowExceptionForHR(Endpoint(out id).SetMute(muted, ref ctx));
        }
    }
}
'@

function Get-DisplayInfo {
    $now = [WinTV.Display]::Current()
    @{
        current = if ($now) { @{ width = $now[0]; height = $now[1]; hz = $now[2] } } else { $null }
        modes   = @([WinTV.Display]::Modes() | ForEach-Object { @{ width = $_[0]; height = $_[1]; hz = $_[2] } })
    }
}

# The output's name, from where Windows keeps it for the device ("Speakers (…)").
function Get-AudioName([string]$DeviceId) {
    $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + ($DeviceId -replace '^.*\.', '') + '\Properties'
    $p = Get-ItemProperty $key -ErrorAction SilentlyContinue
    if ($p) {
        $friendly = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},14'
        if ($friendly) { return $friendly }
        $desc = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
        $iface = $p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
        if ($desc -and $iface) { return "$desc ($iface)" }
        if ($desc) { return $desc }
    }
    return 'Default output'
}

function Get-AudioInfo {
    try { $a = [WinTV.Audio]::Get() } catch { return @{ present = $false } }
    @{ present = $true; device = (Get-AudioName $a[0]); volume = $a[1]; muted = [bool]$a[2] }
}

function Get-NetworkInfo {
    $profiles = @{}
    Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { $profiles[$_.InterfaceIndex] = $_ }
    @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {
        $p = $profiles[$_.InterfaceIndex]
        @{
            name     = $_.InterfaceAlias
            wifi     = [bool]($_.NetAdapter.PhysicalMediaType -match '802\.11')
            network  = if ($p) { $p.Name } else { '' }
            internet = if ($p) { [string]$p.IPv4Connectivity -eq 'Internet' -or [string]$p.IPv6Connectivity -eq 'Internet' } else { $false }
            ipv4     = @($_.IPv4Address | ForEach-Object { $_.IPAddress }) -join ', '
            gateway  = @($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ', '
        }
    })
}

function Get-About {
    $os = Get-CimInstance Win32_OperatingSystem
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $last = $null
    try { $last = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastInstallationSuccessDate } catch { }
    @{
        windows       = $os.Caption
        version       = "$($cv.DisplayVersion) (build $($cv.CurrentBuild).$($cv.UBR))"
        device        = $env:COMPUTERNAME
        uptimeMinutes = [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes
        lastUpdate    = if ($last -and $last.Year -gt 2000) { $last.ToString('o') } else { $null }
        restartNeeded = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
    }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $req = $null
    try {
        $req = $line | ConvertFrom-Json
        $result = switch ($req.op) {
            'display.get' { Get-DisplayInfo }
            'display.set' { @{ code = [WinTV.Display]::Set([int]$req.width, [int]$req.height, [int]$req.hz) } }
            'audio.get'   { Get-AudioInfo }
            'audio.set'   {
                if ($null -ne $req.volume) { [WinTV.Audio]::SetVolume([int]$req.volume) }
                if ($null -ne $req.muted) { [WinTV.Audio]::SetMute([bool]$req.muted) }
                Get-AudioInfo
            }
            'audio.key'   {
                $now = [WinTV.Audio]::Get()
                if ($req.key -eq 'mute') {
                    [WinTV.Audio]::SetMute(-not [bool]$now[2])
                } else {
                    # Steps of 2, like Windows' own volume keys; turning it up unmutes, like a TV.
                    [WinTV.Audio]::SetVolume([int]$now[1] + $(if ($req.key -eq 'up') { 2 } else { -2 }))
                    if ($req.key -eq 'up' -and [bool]$now[2]) { [WinTV.Audio]::SetMute($false) }
                }
                Get-AudioInfo
            }
            'network.get' { @{ connections = @(Get-NetworkInfo) } }
            'about'       { Get-About }
            'process.find' {
                # The browser's main process (no --type=) started with exactly this --user-data-dir.
                $pattern = [regex]::Escape([string]$req.dir) + '("|\s|$)'
                @{ pids = @(Get-CimInstance Win32_Process -Filter "Name='brave.exe' OR Name='chrome.exe'" |
                    Where-Object { $_.CommandLine -and $_.CommandLine -notmatch ' --type=' -and $_.CommandLine -match $pattern } |
                    ForEach-Object { [int]$_.ProcessId }) }
            }
            default       { throw "unknown op '$($req.op)'" }
        }
        $answer = @{ id = $req.id; ok = $true; result = $result }
    } catch {
        $answer = @{ id = $req.id; ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $answer -Compress -Depth 6))
    [Console]::Out.Flush()
}
