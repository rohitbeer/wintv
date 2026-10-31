# WinTV system helper: the WinTV Settings screens' only way into Windows.
# main.js starts it once, as the tv user, and keeps it running. One JSON
# request per line on stdin, one JSON answer per line on stdout:
#   {"id":1,"op":"display.get"}                    current picture mode + the modes the TV offers
#   {"id":2,"op":"display.set","width":1920,"height":1080,"hz":60}
#   {"id":3,"op":"audio.get"}                      output device, volume 0-100, muted
#   {"id":4,"op":"audio.set","volume":40}          or {"muted":true}, or {"output":"<endpoint id>"} (D-43)
#   {"id":7,"op":"audio.key","key":"up"}           the remote's volume keys: up | down | mute
#   {"id":5,"op":"network.get"}                    connections and their addresses
#   {"id":9,"op":"power.get"}                      screen-off and sleep timeouts (plugged in), minutes
#   {"id":10,"op":"power.set","screenOff":30}      or {"sleep":60}; 0 = never
#   {"id":11,"op":"motion.set","reduce":true}      Windows' animation effects off (apps keep still)
#   {"id":12,"op":"apps.list"}                     every app Windows lists for this account, with icons (All apps)
#   {"id":13,"op":"apps.open","app":"<AppID>"}     open one
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
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator { }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }
    // The default-output switch the Sound control panel itself uses: not in
    // the SDK, unchanged since Windows 7. Only SetDefaultEndpoint is called;
    // the methods before it hold its place in the table.
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int useDefault, IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int useDefault, IntPtr defaultPeriod, IntPtr minimumPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
    }
    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    class PolicyConfigClient { }

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

        // Every output that is plugged in and on (D-43); names: Get-AudioName.
        public static string[] Outputs() {
            var devices = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDeviceCollection all;
            Marshal.ThrowExceptionForHR(devices.EnumAudioEndpoints(eRender, 1 /* active */, out all));
            int n;
            Marshal.ThrowExceptionForHR(all.GetCount(out n));
            var ids = new List<string>();
            for (int i = 0; i < n; i++) {
                IMMDevice d; string id;
                if (all.Item(i, out d) == 0 && d.GetId(out id) == 0) ids.Add(id);
            }
            return ids.ToArray();
        }

        // Sound for everything from here on: films and games (console,
        // multimedia) and calls (communications).
        public static void SetOutput(string id) {
            var policy = (IPolicyConfig)new PolicyConfigClient();
            for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(id, role));
        }
    }

    // Windows' "Animation effects" (Settings > Accessibility > Visual effects),
    // per user. Chromium-based apps, Brave included, report it to web pages as
    // prefers-reduced-motion.
    public static class Motion {
        [DllImport("user32.dll", SetLastError = true)] static extern bool SystemParametersInfoW(uint action, uint param, IntPtr value, uint flags);
        const uint SPI_SETCLIENTAREAANIMATION = 0x1043, SPIF_UPDATEINIFILE = 0x1, SPIF_SENDCHANGE = 0x2;

        public static void Set(bool animate) {
            if (!SystemParametersInfoW(SPI_SETCLIENTAREAANIMATION, 0, (IntPtr)(animate ? 1 : 0), SPIF_UPDATEINIFILE | SPIF_SENDCHANGE))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@

# ------------------------------------------------------------------ All apps (D-37)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
namespace WinTV {
    public static class Apps {
        // Packaged apps start through Windows' activation manager (the Apps
        // folder can't start them without Explorer).
        [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IApplicationActivationManager {
            int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, int options, out uint processId);
        }
        [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
        class ApplicationActivationManager { }

        public static uint Activate(string aumid) {
            uint pid;
            ((IApplicationActivationManager)new ApplicationActivationManager()).ActivateApplication(aumid, null, 0, out pid);
            return pid;
        }

        // An app's icon as the shell draws it, 256 pixels, alpha kept.
        [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
        [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
        [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
        [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bm);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

        public static bool SaveIcon(string appId, string file) {
            var iid = typeof(IShellItemImageFactory).GUID;
            IShellItemImageFactory f;
            SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero, ref iid, out f);
            IntPtr hbm;
            if (f.GetImage(new SIZE { cx = 256, cy = 256 }, 0, out hbm) != 0) return false;
            try {
                BITMAP bm;
                GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), out bm);
                using (var view = new Bitmap(bm.bmWidth, bm.bmHeight, bm.bmWidthBytes, PixelFormat.Format32bppPArgb, bm.bmBits))
                using (var copy = new Bitmap(view)) { copy.Save(file, ImageFormat.Png); }
                return true;
            } finally { DeleteObject(hbm); }
        }

        // True if the program's own manifest asks for admin rights
        // (requireAdministrator). The TV account gets no admin prompt (D-42):
        // Windows would show "blocked by your system administrator" instead,
        // so such programs belong on the admin's desktop. "highestAvailable"
        // (Registry Editor, Task Manager) runs as the TV account and is fine.
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
        [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr h);
        [DllImport("kernel32.dll")] static extern IntPtr FindResource(IntPtr h, IntPtr name, IntPtr type);
        [DllImport("kernel32.dll")] static extern IntPtr LoadResource(IntPtr h, IntPtr res);
        [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr data);
        [DllImport("kernel32.dll")] static extern uint SizeofResource(IntPtr h, IntPtr res);

        public static bool NeedsAdmin(string exe) {
            IntPtr h = LoadLibraryEx(exe, IntPtr.Zero, 0x2 | 0x20); // as data: resources only, nothing runs
            if (h == IntPtr.Zero) return false;
            try {
                IntPtr res = FindResource(h, (IntPtr)1, (IntPtr)24); // the program's manifest (RT_MANIFEST 1)
                if (res == IntPtr.Zero) return false;
                IntPtr data = LockResource(LoadResource(h, res));
                int size = (int)SizeofResource(h, res);
                if (data == IntPtr.Zero || size <= 0) return false;
                var bytes = new byte[size];
                Marshal.Copy(data, bytes, 0, size);
                return System.Text.RegularExpressions.Regex.IsMatch(System.Text.Encoding.UTF8.GetString(bytes),
                    "requestedExecutionLevel[^>]*level\\s*=\\s*[\"']requireAdministrator", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            } finally { FreeLibrary(h); }
        }
    }
}
'@

$IconDir = Join-Path $env:LOCALAPPDATA 'WinTV\cache\icons'
# Not on a TV: Explorer itself and what it hosts (its desktop would come
# back): the Run box, Control Panel and the Windows Tools folder; Edge;
# Windows' Settings (WinTV has its own); Click to Do (Copilot).
$HiddenApps = @('Microsoft.Windows.Explorer', 'MSEdge', 'Microsoft.Windows.Shell.RunDialog', 'Microsoft.Windows.AdministrativeTools',
    'Microsoft.Windows.ControlPanel', 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel',
    'MicrosoftWindows.Client.CoreAI_cw5n1h2txyewy!ClickToDoApp')
$ToolPattern = 'AutoGenerated|\.msc$|\{D65231B0|\\(odbcad32|iscsicpl|msconfig|msinfo32|MdSched|RecoveryDrive|psr|regedit|PowerShell_ISE|dfrgui|cleanmgr)\.exe$'

function Get-IconName([string]$Id) {
    $sha = [Security.Cryptography.SHA1]::Create()
    -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Id))[0..7] | ForEach-Object { $_.ToString('x2') })
}

# A packaged app's own logo at its largest (the shell hands out 44 pixels).
function Find-Logo([string]$Root, $App) {
    foreach ($attr in 'Square44x44Logo', 'Square150x150Logo') {
        $rel = $App.VisualElements.$attr
        if (-not $rel) { continue }
        $base = if ($attr -eq 'Square44x44Logo') { 44 } else { 150 }
        $dir = Split-Path (Join-Path $Root $rel)
        $stem = [IO.Path]::GetFileNameWithoutExtension($rel)
        $best = Get-ChildItem $dir -Filter "$stem*.png" -ErrorAction SilentlyContinue | Sort-Object {
            $px = if ($_.Name -match 'targetsize-(\d+)') { [int]$matches[1] } elseif ($_.Name -match 'scale-(\d+)') { $base * [int]$matches[1] / 100 } else { $base }
            $px + $(if ($_.Name -match 'unplated') { 1 } else { 0 }) # no tile plate behind it: better on a TV
        } -Descending | Select-Object -First 1
        if ($best) { return $best.FullName }
    }
    $null
}

function Get-AppList {
    New-Item -ItemType Directory -Force $IconDir | Out-Null
    $packages = @{}
    Get-AppxPackage | ForEach-Object { $packages[$_.PackageFamilyName] = $_ }
    # Desktop programs: the file each entry starts, to read its manifest.
    $targets = @{}
    try {
        foreach ($i in (New-Object -ComObject Shell.Application).NameSpace('shell:AppsFolder').Items()) {
            $t = $i.ExtendedProperty('System.Link.TargetParsingPath')
            if ($t) { $targets[$i.Path] = $t }
        }
    } catch { }
    @(Get-StartApps | Where-Object { $HiddenApps -notcontains $_.AppID } | ForEach-Object {
        $id = $_.AppID
        $desktopOnly = $false
        $logo = $null
        if ($id -match '^([^!]+)!(.+)$' -and $packages[$matches[1]]) {
            $pkg = $packages[$matches[1]]
            $appId = $matches[2]
            $app = @(([xml](Get-Content (Join-Path $pkg.InstallLocation 'AppxManifest.xml') -Raw)).Package.Applications.Application) |
                Where-Object { $_.Id -eq $appId } | Select-Object -First 1
            # Packaged desktop apps (Notepad, Terminal) run on the TV; the older
            # kind needs Explorer's window host (D-19).
            $desktopOnly = [bool]$app -and $app.EntryPoint -ne 'Windows.FullTrustApplication'
            if ($app) { $logo = Find-Logo $pkg.InstallLocation $app }
        } elseif ($targets[$id] -match '\.exe$' -and [WinTV.Apps]::NeedsAdmin($targets[$id])) {
            $desktopOnly = $true # asks for admin rights (D-42)
        }
        $icon = (Get-IconName $id) + '.png'
        $file = Join-Path $IconDir $icon
        if (-not (Test-Path $file)) {
            try { if ($logo) { Copy-Item $logo $file } elseif (-not [WinTV.Apps]::SaveIcon($id, $file)) { $icon = $null } } catch { $icon = $null }
        }
        @{ id = $id; name = $_.Name; tool = [bool]($id -match $ToolPattern); desktopOnly = $desktopOnly; icon = $icon }
    })
}

function Open-App([string]$Id) {
    if ($Id -match '!') { return @{ pid = [int][WinTV.Apps]::Activate($Id) } }
    # A program that asks for admin rights would only bring up Windows' "blocked
    # by your system administrator" box (D-42): say where it opens instead.
    $item = (New-Object -ComObject Shell.Application).NameSpace('shell:AppsFolder').ParseName($Id)
    $target = if ($item) { $item.ExtendedProperty('System.Link.TargetParsingPath') }
    if ($target -match '\.exe$' -and [WinTV.Apps]::NeedsAdmin($target)) {
        throw 'This app needs the admin. Open it from Settings > Admin > Windows desktop.'
    }
    # Process.Start, not Start-Process: that one keeps only a translated message.
    $psi = New-Object Diagnostics.ProcessStartInfo "shell:AppsFolder\$Id"
    $psi.UseShellExecute = $true
    try { [void][Diagnostics.Process]::Start($psi) }
    catch {
        # The TV account gets no admin prompts (D-42): Windows refuses at once
        # (1260 blocked by policy; 740 needs elevation; 1223 cancelled; 5 denied).
        $w = $_.Exception.InnerException
        if ($w -is [ComponentModel.Win32Exception] -and $w.NativeErrorCode -in 5, 740, 1223, 1260) {
            throw 'This app needs the admin. Open it from Settings > Admin > Windows desktop.'
        }
        throw
    }
    @{ pid = 0 }
}

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
    $outputs = @(try { [WinTV.Audio]::Outputs() } catch { }) | ForEach-Object { @{ id = $_; name = (Get-AudioName $_); current = ($_ -eq $a[0]) } }
    @{ present = $true; device = (Get-AudioName $a[0]); volume = $a[1]; muted = [bool]$a[2]; outputs = @($outputs) }
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

# The power plan's timeouts while plugged in. powercfg's labels are in the
# display language, so the value is read by position: the last two numbers
# of a setting are its plugged-in and battery values, in seconds.
$PowerTimeouts = @{
    screenOff = @('SUB_VIDEO', 'VIDEOIDLE', 'monitor-timeout-ac')
    sleep     = @('SUB_SLEEP', 'STANDBYIDLE', 'standby-timeout-ac')
}

function Get-PowerInfo {
    $info = @{}
    foreach ($name in $PowerTimeouts.Keys) {
        $t = $PowerTimeouts[$name]
        $out = & "$env:SystemRoot\System32\powercfg.exe" /query SCHEME_CURRENT $t[0] $t[1]
        if ($LASTEXITCODE) { throw "powercfg /query $($t[1]): exit $LASTEXITCODE" }
        $hex = @([regex]::Matches(($out -join "`n"), '0x[0-9a-fA-F]{8}') | ForEach-Object { $_.Value })
        $info[$name] = [int]([Convert]::ToInt64($hex[-2], 16) / 60)
    }
    $info
}

function Set-PowerTimeout([string]$Name, [int]$Minutes) {
    $out = & "$env:SystemRoot\System32\powercfg.exe" /change $PowerTimeouts[$Name][2] $Minutes
    if ($LASTEXITCODE) { throw "powercfg /change: $($out -join ' ')" }
}

# Files (D-40): the drives, and this account's SID for its Recycle Bins.
# Removable drives (USB sticks) have no Recycle Bin; fixed ones, USB disks
# included, do. The system drive's bin counts, but Files doesn't show C:\.
function Get-Drives {
    $sys = "$env:SystemDrive\"
    $list = foreach ($d in [IO.DriveInfo]::GetDrives()) {
        if (-not $d.IsReady -or [string]$d.DriveType -notin 'Removable', 'Fixed') { continue }
        @{ root = $d.Name; label = $d.VolumeLabel; removable = ([string]$d.DriveType -eq 'Removable'); system = ($d.Name -eq $sys) }
    }
    @{ sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; drives = @($list) }
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
                if ($req.output) {
                    # Only an output that is there now (main.js checked the form).
                    if (@([WinTV.Audio]::Outputs()) -notcontains [string]$req.output) { throw 'That output isn''t connected any more' }
                    [WinTV.Audio]::SetOutput([string]$req.output)
                }
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
            'power.get'   { Get-PowerInfo }
            'power.set'   {
                if ($null -ne $req.screenOff) { Set-PowerTimeout 'screenOff' ([int]$req.screenOff) }
                if ($null -ne $req.sleep) { Set-PowerTimeout 'sleep' ([int]$req.sleep) }
                Get-PowerInfo
            }
            'motion.set'  { [WinTV.Motion]::Set(-not [bool]$req.reduce); @{ reduce = [bool]$req.reduce } }
            'apps.list'   { @{ apps = @(Get-AppList) } }
            'apps.open'   { Open-App ([string]$req.app) }
            'about'       { Get-About }
            'drives.get'  { Get-Drives }
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
