# WinTV system helper: the WinTV Settings screens' only way into Windows.
# main.js starts it once, as the tv user, and keeps it running. One JSON
# request per line on stdin, one JSON answer per line on stdout:
#   {"id":1,"op":"display.get"}                    current picture mode + the modes the TV offers + the graphics adapters
#   {"id":21,"op":"graphics.get"}                  the graphics adapters, and whether this session is on the screen (D-47)
#   {"id":2,"op":"display.set","width":1920,"height":1080,"hz":60}
#   {"id":3,"op":"audio.get"}                      output device, volume 0-100, muted
#   {"id":4,"op":"audio.set","volume":40}          or {"muted":true}, or {"output":"<endpoint id>"} (D-43)
#   {"id":7,"op":"audio.key","key":"up"}           the remote's volume keys: up | down | mute
#   {"id":5,"op":"network.get"}                    connections and their addresses, and whether there is Wi-Fi
#   {"id":15,"op":"wifi.scan"}                     networks near by; status none | consent | ok (D-44)
#   {"id":16,"op":"wifi.allow"}                    this account's location consent, then wifi.scan
#   {"id":17,"op":"wifi.connect","ssid":"Home","key":"...","auth":"wpa2","hidden":false,"profile":""}
#   {"id":18,"op":"bt.list"}                       paired Bluetooth devices; radio false = none (D-46)
#   {"id":19,"op":"bt.scan"}                       ... and every device in range (about 10 s)
#   {"id":20,"op":"bt.pair","address":"A0:AB:51:12:34:56"}   or bt.forget
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

        // Whether this session is the one on the screen, or another account's is (D-47).
        [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
        public static bool OnConsole() { return WTSGetActiveConsoleSessionId() == (uint)System.Diagnostics.Process.GetCurrentProcess().SessionId; }

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

# Wi-Fi from the TV (D-44): Windows' Native Wi-Fi API. Listing networks needs
# location consent since Windows 11 24H2 (WlanScan and WlanGetAvailableNetworkList
# answer 5 without it); saving a profile and connecting don't.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Threading;
namespace WinTV {
    public class WifiNetwork {
        public string Ssid; public int Signal; public bool Secure; public bool Connected; public bool Saved; public string Auth; public string Profile;
    }

    public static class Wifi {
        [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(int clientVersion, IntPtr reserved, out int negotiated, out IntPtr handle);
        [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr handle, IntPtr reserved);
        [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
        [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr handle, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr reserved);
        [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr handle, ref Guid iface, int flags, IntPtr reserved, out IntPtr list);
        [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanSetProfile(IntPtr handle, ref Guid iface, int flags, string xml, string sddl, bool overwrite, IntPtr reserved, out int reason);
        [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanDeleteProfile(IntPtr handle, ref Guid iface, string name, IntPtr reserved);
        [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr handle, ref Guid iface, ref ConnectionParameters p, IntPtr reserved);
        [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr handle, ref Guid iface, int opcode, IntPtr reserved, out int size, out IntPtr data, IntPtr valueType);
        [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct ConnectionParameters {
            public int Mode;                                       // 0: by profile
            [MarshalAs(UnmanagedType.LPWStr)] public string Profile;
            public IntPtr Ssid, Bssids;
            public int BssType;                                    // 1: infrastructure
            public int Flags;
        }

        public const int NoAdapter = -1, NoConsent = 5;

        // The first Wi-Fi adapter, or false. A PC without Wi-Fi has no WLAN
        // service running at all (WlanOpenHandle fails): the same answer.
        static bool Open(out IntPtr handle, out Guid iface) {
            iface = Guid.Empty;
            int v;
            if (WlanOpenHandle(2, IntPtr.Zero, out v, out handle) != 0) { handle = IntPtr.Zero; return false; }
            IntPtr list;
            if (WlanEnumInterfaces(handle, IntPtr.Zero, out list) != 0) return false;
            try {
                if (Marshal.ReadInt32(list) < 1) return false;
                byte[] g = new byte[16];
                Marshal.Copy(new IntPtr(list.ToInt64() + 8), g, 0, 16);   // WLAN_INTERFACE_INFO.InterfaceGuid
                iface = new Guid(g);
                return true;
            } finally { WlanFreeMemory(list); }
        }

        static void Close(IntPtr handle) { if (handle != IntPtr.Zero) WlanCloseHandle(handle, IntPtr.Zero); }

        public static bool HasAdapter() {
            IntPtr h; Guid g;
            bool ok = Open(out h, out g);
            Close(h);
            return ok;
        }

        // DOT11_AUTH_ALGORITHM and cipher, as WinTV names them.
        static string AuthName(int auth, int cipher) {
            switch (auth) {
                case 1: return cipher == 0 ? "open" : "wep";
                case 2: return "wep";
                case 4: return "wpa";
                case 7: return "wpa2";
                case 9: return "wpa3";
                case 10: return "owe";
                default: return "enterprise";   // 802.1X: needs a certificate or a user name
            }
        }

        // 0 and the networks near by (strongest first, one entry per name), or
        // NoAdapter / NoConsent / another Windows error code.
        public static int Scan(out List<WifiNetwork> found) {
            found = new List<WifiNetwork>();
            IntPtr h; Guid g;
            if (!Open(out h, out g)) { Close(h); return NoAdapter; }
            try {
                int r = WlanScan(h, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (r == NoConsent) return NoConsent;
                if (r == 0) Thread.Sleep(3500);                     // the scan finishes by itself, within 4 s
                IntPtr list;
                r = WlanGetAvailableNetworkList(h, ref g, 0, IntPtr.Zero, out list);
                if (r != 0) return r;
                try {
                    int n = Marshal.ReadInt32(list);
                    var byName = new Dictionary<string, WifiNetwork>();
                    for (int i = 0; i < n; i++) {
                        long at = list.ToInt64() + 8 + i * 628;      // WLAN_AVAILABLE_NETWORK is 628 bytes
                        int len = Math.Min(32, Marshal.ReadInt32(new IntPtr(at + 512)));
                        if (len <= 0) continue;                       // a hidden network: no name to show
                        byte[] raw = new byte[len];
                        Marshal.Copy(new IntPtr(at + 516), raw, 0, len);
                        string ssid = Encoding.UTF8.GetString(raw);
                        int flags = Marshal.ReadInt32(new IntPtr(at + 620));
                        string profile = Marshal.PtrToStringUni(new IntPtr(at));   // strProfileName, "" if not saved
                        var net = new WifiNetwork {
                            Profile = profile,
                            Ssid = ssid,
                            Signal = Marshal.ReadInt32(new IntPtr(at + 604)),
                            Secure = Marshal.ReadInt32(new IntPtr(at + 608)) != 0,
                            Auth = AuthName(Marshal.ReadInt32(new IntPtr(at + 612)), Marshal.ReadInt32(new IntPtr(at + 616))),
                            Connected = (flags & 1) != 0,
                            Saved = (flags & 2) != 0,
                        };
                        WifiNetwork had;
                        if (byName.TryGetValue(ssid, out had)) {
                            had.Connected |= net.Connected; had.Saved |= net.Saved; had.Signal = Math.Max(had.Signal, net.Signal);
                            if (string.IsNullOrEmpty(had.Profile)) had.Profile = net.Profile;
                        } else byName[ssid] = net;
                    }
                    found.AddRange(byName.Values);
                    found.Sort((a, b) => b.Connected.CompareTo(a.Connected) != 0 ? b.Connected.CompareTo(a.Connected) : b.Signal.CompareTo(a.Signal));
                    return 0;
                } finally { WlanFreeMemory(list); }
            } finally { Close(h); }
        }

        static string Profile(string ssid, string key, string auth, bool hidden) {
            var hex = new StringBuilder();
            foreach (byte b in Encoding.UTF8.GetBytes(ssid)) hex.Append(b.ToString("X2"));
            string security;
            if (auth == "open") security = "<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>";
            else {
                string a = auth == "wpa3" ? "WPA3SAE" : auth == "wpa" ? "WPAPSK" : "WPA2PSK";
                string c = auth == "wpa" ? "TKIP" : "AES";
                security = "<authEncryption><authentication>" + a + "</authentication><encryption>" + c + "</encryption><useOneX>false</useOneX></authEncryption>"
                    + "<sharedKey><keyType>" + (key.Length == 64 ? "networkKey" : "passPhrase") + "</keyType><protected>false</protected><keyMaterial>"
                    + SecurityElement.Escape(key) + "</keyMaterial></sharedKey>";
            }
            return "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">"
                + "<name>" + SecurityElement.Escape(ssid) + "</name>"
                + "<SSIDConfig><SSID><hex>" + hex + "</hex><name>" + SecurityElement.Escape(ssid) + "</name></SSID>"
                + "<nonBroadcast>" + (hidden ? "true" : "false") + "</nonBroadcast></SSIDConfig>"
                + "<connectionType>ESS</connectionType><connectionMode>auto</connectionMode>"
                + "<MSM><security>" + security + "</security></MSM></WLANProfile>";
        }

        // Saves the network (for every account if Windows allows, else for
        // this one) unless key is null and it is saved already, then connects
        // and waits up to 25 s. "" when connected, else what went wrong. A new
        // profile that didn't connect (a wrong password) is removed again.
        public static string Connect(string ssid, string key, string auth, bool hidden, string savedProfile) {
            IntPtr h; Guid g;
            if (!Open(out h, out g)) { Close(h); return "This PC has no Wi-Fi"; }
            bool created = false;
            try {
                if (key != null || auth == "open") {
                    int reason;
                    string xml = Profile(ssid, key ?? "", auth, hidden);
                    int r = WlanSetProfile(h, ref g, 0, xml, null, true, IntPtr.Zero, out reason);
                    if (r == 5) r = WlanSetProfile(h, ref g, 2, xml, null, true, IntPtr.Zero, out reason);   // just this account
                    if (r != 0) return "Windows didn't take the network (error " + r + ", reason " + reason + ")";
                    created = true;
                }
                string name = created || string.IsNullOrEmpty(savedProfile) ? ssid : savedProfile;
                var p = new ConnectionParameters { Mode = 0, Profile = name, BssType = 1 };
                int c = WlanConnect(h, ref g, ref p, IntPtr.Zero);
                if (c != 0) return "Windows couldn't connect (error " + c + ")";
                for (int i = 0; i < 50; i++) {
                    Thread.Sleep(500);
                    int size; IntPtr data;
                    if (WlanQueryInterface(h, ref g, 6 /* interface state */, IntPtr.Zero, out size, out data, IntPtr.Zero) != 0) continue;
                    int state = Marshal.ReadInt32(data);
                    WlanFreeMemory(data);
                    if (state == 1) { created = false; return ""; }    // connected
                    if (state == 4 && i > 6) break;                      // gave up: disconnected
                }
                return auth == "open" ? "Couldn't connect" : "Couldn't connect: check the password";
            } finally {
                if (created) WlanDeleteProfile(h, ref g, ssid, IntPtr.Zero);
                Close(h);
            }
        }
    }
}
'@

# Location consent for listing networks: the device-wide switch is set once
# by the boot task (maintain.ps1, D-44); this account's own is set here when
# someone says yes on the TV.
function Set-WifiConsent {
    $b = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location'
    New-Item -Path "$b\NonPackaged" -Force | Out-Null
    Set-ItemProperty -Path $b -Name Value -Value 'Allow'
    Set-ItemProperty -Path "$b\NonPackaged" -Name Value -Value 'Allow'
}

function Get-WifiNetworks {
    $list = $null
    $code = [WinTV.Wifi]::Scan([ref]$list)
    if ($code -eq [WinTV.Wifi]::NoAdapter) { return @{ status = 'none' } }
    if ($code -eq [WinTV.Wifi]::NoConsent) { return @{ status = 'consent' } }
    if ($code -ne 0) { throw "Windows couldn't list Wi-Fi networks (error $code)" }
    @{ status = 'ok'; networks = @($list | ForEach-Object { @{ ssid = $_.Ssid; signal = $_.Signal; secure = $_.Secure; connected = $_.Connected; saved = $_.Saved; auth = $_.Auth; profile = $_.Profile } }) }
}

# Bluetooth from the TV (D-46): Windows' classic Bluetooth API (bthprops),
# which pairs controllers and headphones. WinTV answers the pairing itself:
# confirm for "just works" and number comparison, "0000" for old devices.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace WinTV {
    public class BtDevice { public string Address, Name, Kind; public bool Paired, Connected; }

    public static class Bluetooth {
        [StructLayout(LayoutKind.Sequential)] struct FIND_RADIO { public int dwSize; }
        [StructLayout(LayoutKind.Sequential)] struct SEARCH {
            public int dwSize, fReturnAuthenticated, fReturnRemembered, fReturnUnknown, fReturnConnected, fIssueInquiry;
            public byte cTimeoutMultiplier; public IntPtr hRadio;
        }
        [StructLayout(LayoutKind.Sequential)] struct SYSTEMTIME { public ushort a, b, c, d, e, f, g, h; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct DEVICE_INFO {
            public int dwSize; public ulong Address; public uint ClassOfDevice; public int Connected, Remembered, Authenticated;
            public SYSTEMTIME LastSeen, LastUsed;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string Name;
        }
        [StructLayout(LayoutKind.Sequential)] struct AUTH_PARAMS { public DEVICE_INFO Device; public int Method, IoCapability, Requirements; public uint NumericValue; }
        [StructLayout(LayoutKind.Sequential)] struct AUTH_RESPONSE {
            public ulong Address; public int Method;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Info;
            public byte Negative;
        }
        delegate bool AuthCallback(IntPtr param, IntPtr authParams);

        [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstRadio(ref FIND_RADIO p, out IntPtr radio);
        [DllImport("bthprops.cpl")] static extern bool BluetoothFindRadioClose(IntPtr find);
        [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstDevice(ref SEARCH p, ref DEVICE_INFO info);
        [DllImport("bthprops.cpl", SetLastError = true)] static extern bool BluetoothFindNextDevice(IntPtr find, ref DEVICE_INFO info);
        [DllImport("bthprops.cpl")] static extern bool BluetoothFindDeviceClose(IntPtr find);
        [DllImport("bthprops.cpl")] static extern int BluetoothGetDeviceInfo(IntPtr radio, ref DEVICE_INFO info);
        [DllImport("bthprops.cpl")] static extern int BluetoothAuthenticateDeviceEx(IntPtr hwnd, IntPtr radio, ref DEVICE_INFO info, IntPtr oob, int requirements);
        [DllImport("bthprops.cpl")] static extern int BluetoothRegisterForAuthenticationEx(ref DEVICE_INFO info, out IntPtr registration, AuthCallback callback, IntPtr param);
        [DllImport("bthprops.cpl")] static extern bool BluetoothUnregisterAuthentication(IntPtr registration);
        [DllImport("bthprops.cpl")] static extern int BluetoothSendAuthenticationResponseEx(IntPtr radio, ref AUTH_RESPONSE response);
        [DllImport("bthprops.cpl")] static extern int BluetoothSetServiceState(IntPtr radio, ref DEVICE_INFO info, ref Guid service, int flags);
        [DllImport("bthprops.cpl")] static extern int BluetoothRemoveDevice(ref ulong address);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

        public const int NoRadio = -1;
        static AuthCallback answer;   // kept referenced while Windows may call it

        static IntPtr Radio() {
            var p = new FIND_RADIO { dwSize = Marshal.SizeOf(typeof(FIND_RADIO)) };
            IntPtr radio;
            IntPtr find = BluetoothFindFirstRadio(ref p, out radio);
            if (find == IntPtr.Zero) return IntPtr.Zero;
            BluetoothFindRadioClose(find);
            return radio;
        }

        public static string Format(ulong a) {
            var parts = new string[6];
            for (int i = 0; i < 6; i++) parts[i] = ((a >> (8 * (5 - i))) & 0xFF).ToString("X2");
            return string.Join(":", parts);
        }

        public static ulong Parse(string s) { return Convert.ToUInt64(s.Replace(":", ""), 16); }

        // What it is, from its Class of Device: what WinTV shows next to the name.
        static string Kind(uint cod) {
            uint major = (cod >> 8) & 0x1F, minor = (cod >> 2) & 0x3F;
            if (major == 5) {
                if ((minor & 0x0F) == 2 || (minor & 0x0F) == 1) return "controller";
                if ((minor & 0x0F) == 3) return "remote";
                if ((minor & 0x10) != 0) return "keyboard";
                if ((minor & 0x20) != 0) return "mouse";
                return "input";
            }
            if (major == 4) return minor == 5 || minor == 10 ? "speaker" : "headphones";
            if (major == 2) return "phone";
            if (major == 1) return "computer";
            return "other";
        }

        // NoRadio, or 0 and the devices: paired ones, and with search, all in range (about 10 s).
        public static int List(bool search, out List<BtDevice> found) {
            found = new List<BtDevice>();
            IntPtr radio = Radio();
            if (radio == IntPtr.Zero) return NoRadio;
            try {
                var s = new SEARCH {
                    dwSize = Marshal.SizeOf(typeof(SEARCH)), fReturnAuthenticated = 1, fReturnRemembered = 1, fReturnConnected = 1,
                    fReturnUnknown = search ? 1 : 0, fIssueInquiry = search ? 1 : 0, cTimeoutMultiplier = (byte)(search ? 8 : 0), hRadio = radio,
                };
                var d = new DEVICE_INFO { dwSize = Marshal.SizeOf(typeof(DEVICE_INFO)) };
                IntPtr f = BluetoothFindFirstDevice(ref s, ref d);
                if (f == IntPtr.Zero) return 0;
                try {
                    do {
                        found.Add(new BtDevice {
                            Address = Format(d.Address), Name = string.IsNullOrEmpty(d.Name) ? "" : d.Name, Kind = Kind(d.ClassOfDevice),
                            Paired = d.Authenticated != 0 || d.Remembered != 0, Connected = d.Connected != 0,
                        });
                        d = new DEVICE_INFO { dwSize = Marshal.SizeOf(typeof(DEVICE_INFO)) };
                    } while (BluetoothFindNextDevice(f, ref d));
                } finally { BluetoothFindDeviceClose(f); }
                return 0;
            } finally { CloseHandle(radio); }
        }

        // "" when paired (and its services on), else what went wrong.
        public static string Pair(string address) {
            IntPtr radio = Radio();
            if (radio == IntPtr.Zero) return "This PC has no Bluetooth";
            IntPtr reg = IntPtr.Zero;
            try {
                var d = new DEVICE_INFO { dwSize = Marshal.SizeOf(typeof(DEVICE_INFO)), Address = Parse(address) };
                int e = BluetoothGetDeviceInfo(radio, ref d);
                if (e != 0) return "Not found any more: search again";
                if (d.Authenticated == 0) {
                    answer = (param, p) => {
                        var ap = (AUTH_PARAMS)Marshal.PtrToStructure(p, typeof(AUTH_PARAMS));
                        var r = new AUTH_RESPONSE { Address = ap.Device.Address, Method = ap.Method, Info = new byte[32] };
                        if (ap.Method == 1) { for (int i = 0; i < 4; i++) r.Info[i] = (byte)'0'; r.Info[16] = 4; }   // legacy PIN 0000
                        else BitConverter.GetBytes(ap.NumericValue).CopyTo(r.Info, 0);                                // confirm what it shows
                        BluetoothSendAuthenticationResponseEx(radio, ref r);
                        return true;
                    };
                    BluetoothRegisterForAuthenticationEx(ref d, out reg, answer, IntPtr.Zero);
                    e = BluetoothAuthenticateDeviceEx(IntPtr.Zero, radio, ref d, IntPtr.Zero, 0x2 /* no MITM protection, bonding */);
                    if (e == 5) return "Windows didn't let the TV account pair it: pair it once on the Windows desktop (Settings > Admin)";
                    if (e != 0 && e != 0xB7 /* already exists */) return "Didn't pair (error " + e + "): put it in pairing mode and try again";
                }
                // What it is for: game controllers and remotes are HID, headphones audio.
                foreach (string uuid in new[] { "00001124", "0000110B", "0000110E", "0000111E" }) {
                    var g = new Guid(uuid + "-0000-1000-8000-00805F9B34FB");
                    BluetoothSetServiceState(radio, ref d, ref g, 1);   // a service it doesn't have is refused; fine
                }
                return "";
            } finally {
                if (reg != IntPtr.Zero) BluetoothUnregisterAuthentication(reg);
                CloseHandle(radio);
            }
        }

        public static string Forget(string address) {
            ulong a = Parse(address);
            int e = BluetoothRemoveDevice(ref a);
            return e == 0 || e == 1168 /* not found */ ? "" : "Windows didn't forget it (error " + e + ")";
        }
    }
}
'@

# Pairing the way Windows' own Settings pairs (WinRT
# DeviceInformationCustomPairing), with WinTV answering the question Windows
# would ask on screen: the classic BluetoothAuthenticateDeviceEx answered
# 1244 (not authenticated) for a DualSense on the first real PC (D-51).
# Compiled on its own: if it doesn't compile, the classic way is still there.
$BtLog = Join-Path $env:LOCALAPPDATA 'WinTV\bluetooth.log'
function Write-BtLog([string]$Text) {
    try { Add-Content -Path $BtLog -Value ((Get-Date -Format s) + ' ' + $Text) -Encoding UTF8 } catch { }
}
$WinRtPair = $null   # compiled on the first pairing: $true, or $false if it can't be
function Initialize-WinRtPair {
    if ($null -ne $script:WinRtPair) { return }
    $script:WinRtPair = $false
    try {
        $meta = Join-Path $env:SystemRoot 'System32\WinMetadata'
        $rt = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
        # Straight to the compiler: Add-Type's own reference list can't load .winmd files.
        $cp = New-Object System.CodeDom.Compiler.CompilerParameters
        $cp.GenerateInMemory = $true
        foreach ($r in 'System.dll', (Join-Path $meta 'Windows.Devices.winmd'), (Join-Path $meta 'Windows.Foundation.winmd'), (Join-Path $rt 'System.Runtime.dll'), (Join-Path $rt 'System.Runtime.InteropServices.WindowsRuntime.dll')) {
            [void]$cp.ReferencedAssemblies.Add($r)
        }
        Add-Type -CompilerParameters $cp -ErrorAction Stop -TypeDefinition @'
using System;
using System.Threading;
using Windows.Devices.Bluetooth;
using Windows.Devices.Enumeration;
using Windows.Foundation;
namespace WinTV {
    public static class BtPair {
        // Windows' async calls, waited for by asking their status: AsTask
        // needs a contract file that PCs don't have (seen on VM 223).
        static bool Wait(IAsyncInfo op, int ms) {
            for (int t = 0; t < ms; t += 50) {
                if (op.Status != AsyncStatus.Started) return true;
                Thread.Sleep(50);
            }
            op.Cancel();
            return false;
        }

        static string Why(IAsyncInfo op) {
            return op.ErrorCode != null ? op.ErrorCode.Message : op.Status.ToString();
        }

        // Windows' answer (Paired, AlreadyPaired, AuthenticationTimeout...),
        // and what it asked; NotFound / Unavailable: when it can't try.
        public static string Pair(ulong address) {
            BluetoothDevice dev;
            try {
                var find = BluetoothDevice.FromBluetoothAddressAsync(address);
                if (!Wait(find, 15000)) return "Unavailable: no answer";
                if (find.Status != AsyncStatus.Completed) return "Unavailable: " + Why(find);
                dev = find.GetResults();
            } catch (Exception e) { return "Unavailable: " + e.GetBaseException().Message; }
            if (dev == null) return "NotFound";
            string asked = "";
            try {
                var pairing = dev.DeviceInformation.Pairing;
                if (pairing.IsPaired) return "AlreadyPaired";
                var custom = pairing.Custom;
                TypedEventHandler<DeviceInformationCustomPairing, DevicePairingRequestedEventArgs> answer = (s, e) => {
                    asked += " " + e.PairingKind;
                    if (e.PairingKind == DevicePairingKinds.ProvidePin) e.Accept("0000"); else e.Accept();
                };
                custom.PairingRequested += answer;
                try {
                    var kinds = DevicePairingKinds.ConfirmOnly | DevicePairingKinds.ConfirmPinMatch | DevicePairingKinds.DisplayPin | DevicePairingKinds.ProvidePin;
                    var pair = custom.PairAsync(kinds, DevicePairingProtectionLevel.None);
                    if (!Wait(pair, 45000)) return "AuthenticationTimeout; asked" + asked;
                    if (pair.Status != AsyncStatus.Completed) return "Failed: " + Why(pair) + "; asked" + asked;
                    return pair.GetResults().Status + "; asked" + asked;
                } finally { custom.PairingRequested -= answer; }
            } catch (Exception e) {
                return "Failed: " + e.GetBaseException().Message + "; asked" + asked;
            } finally { dev.Dispose(); }
        }
    }
}
'@
        $script:WinRtPair = $true
    } catch { Write-BtLog ('Windows pairing not available: ' + $_.Exception.Message) }
}

function Invoke-BtPair([string]$Address) {
    Initialize-WinRtPair
    if ($script:WinRtPair) {
        $r = [WinTV.BtPair]::Pair([WinTV.Bluetooth]::Parse($Address))
        Write-BtLog "pair $Address with Windows' pairing: $r"
        if ($r -match '^(Paired|AlreadyPaired)\b') { return }
        if ($r -match '^(AuthenticationTimeout|NotReadyToPair|ConnectionRejected|PairingCanceled)\b') {
            throw 'It stopped waiting: put it in pairing mode again (PS5 controller: hold PS and Create until the light flashes) and pick it at once'
        }
        if ($r -match '^AccessDenied\b') { throw "Windows didn't let the TV account pair it: pair it once on the Windows desktop (Settings > Admin)" }
        if ($r -notmatch '^(NotFound|Unavailable)\b') { throw ("Didn't pair (" + ($r -split ';')[0] + '): put it in pairing mode and try again') }
    }
    $e = [WinTV.Bluetooth]::Pair($Address)
    Write-BtLog "pair $Address the classic way: $(if ($e) { $e } else { 'paired' })"
    if ($e) { throw $e }
}

function Get-BtDevices([bool]$Search) {
    $list = $null
    if ([WinTV.Bluetooth]::List($Search, [ref]$list) -eq [WinTV.Bluetooth]::NoRadio) { return @{ radio = $false } }
    @{ radio = $true; devices = @($list | ForEach-Object { @{ address = $_.Address; name = $_.Name; kind = $_.Kind; paired = $_.Paired; connected = $_.Connected } }) }
}

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

# What a package's manifest or a program's file says about each app, per
# version: read once per session, as All apps asks again each time (D-49).
$AppFacts = @{}

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
            $key = $pkg.PackageFullName + '!' + $appId
            if (-not $AppFacts.ContainsKey($key)) {
                $app = @(([xml](Get-Content (Join-Path $pkg.InstallLocation 'AppxManifest.xml') -Raw)).Package.Applications.Application) |
                    Where-Object { $_.Id -eq $appId } | Select-Object -First 1
                # Packaged desktop apps (Notepad, Terminal) run on the TV; the older
                # kind needs Explorer's window host (D-19).
                $only = [bool]$app -and $app.EntryPoint -ne 'Windows.FullTrustApplication'
                $found = $null
                if ($app) { $found = Find-Logo $pkg.InstallLocation $app }
                $AppFacts[$key] = @{ desktopOnly = $only; logo = $found }
            }
            $desktopOnly = $AppFacts[$key].desktopOnly
            $logo = $AppFacts[$key].logo
        } elseif ($targets[$id] -match '\.exe$') {
            $exe = $targets[$id]
            $key = $exe + '|' + [IO.File]::GetLastWriteTimeUtc($exe).Ticks
            if (-not $AppFacts.ContainsKey($key)) { $AppFacts[$key] = @{ desktopOnly = [WinTV.Apps]::NeedsAdmin($exe) } }
            $desktopOnly = $AppFacts[$key].desktopOnly # asks for admin rights (D-42)
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
        adapters = @(Get-GraphicsAdapters)
    }
}

# The graphics adapters (D-47). basic: Windows' own fallback driver, which
# draws without the card's acceleration and offers one picture mode: it is
# display.inf whatever the card, while its name is translated.
function Get-GraphicsAdapters {
    @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
        @{
            id     = [string]$_.PNPDeviceID
            name   = [string]$_.Name
            driver = [string]$_.DriverVersion
            basic  = ([string]$_.InfFilename -eq 'display.inf') -or ([string]$_.Name -like 'Microsoft Basic Display*')
            ok     = ($_.ConfigManagerErrorCode -eq 0)
        }
    })
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
            'graphics.get' { @{ adapters = @(Get-GraphicsAdapters); onConsole = [WinTV.Display]::OnConsole() } }
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
            'network.get' { @{ connections = @(Get-NetworkInfo); wifi = [WinTV.Wifi]::HasAdapter() } }
            'wifi.scan'   { Get-WifiNetworks }
            'bt.list'     { Get-BtDevices $false }
            'bt.scan'     { Get-BtDevices $true }
            'bt.pair'     { Invoke-BtPair ([string]$req.address); Get-BtDevices $false }
            'bt.forget'   { $e = [WinTV.Bluetooth]::Forget([string]$req.address); if ($e) { throw $e }; Get-BtDevices $false }
            'wifi.allow'  { Set-WifiConsent; Get-WifiNetworks }
            'wifi.connect' {
                # $null would reach C# as "" (PowerShell's rule): no key = use the saved network.
                $key = if ($null -ne $req.key) { [string]$req.key } else { [NullString]::Value }
                $err = [WinTV.Wifi]::Connect([string]$req.ssid, $key, [string]$req.auth, [bool]$req.hidden, [string]$req.profile)
                if ($err) { throw $err }
                @{ connected = $true }
            }
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
