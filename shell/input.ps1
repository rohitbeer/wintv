# WinTV input service: the remote's system keys, for the whole TV account.
# main.js starts it once, as the tv user. Windows normally gives these keys
# to Explorer (Home, volume) or to whichever app is in front; on WinTV the
# shell owns them, in every app, the way a TV's own buttons work.
#
# Out (one JSON object per line):
#   {"ev":"key","k":"home","down":true,"repeat":false}   home | quick | volup | voldown | mute (quick = the Windows key held)
#   {"ev":"key","k":"left","down":true,"repeat":false}   left|right|up|down|ok|back, only while grabbed
#   {"ev":"text","on":true,"password":false,"pid":123}   a text field got (or lost) the focus, in any app
#   {"ev":"hwtype"}                                       someone typed on a real keyboard (which key is never sent)
#   {"ev":"grab-expired"}                                 nobody used the system layer for 2 minutes
#   {"ev":"device","kind":"remote"}                      a remote or a keyboard was first used (once each)
#   {"ev":"pad","b":"ok","down":true,"repeat":false}     a PlayStation controller (D-45, see WinTV.Pads)
#   {"ev":"pad-open","name":"DualSense","bt":true}       ... and one was found
#   {"ev":"ready","hook":true,"uia":true}
# In (one JSON object per line):
#   {"op":"grab","on":true}        arrows/OK/Back go to the system layer instead of the app
#   {"op":"type","text":"abc"}     type into whatever has the focus
#   {"op":"key","key":"backspace"} backspace | enter | left | right | up | down | escape | browserback | tab | f11 | address (Ctrl+L)
#   {"op":"wheel","notches":-1}    the mouse wheel in the app in front (negative = down)
#   {"op":"screen-off"}            picture off; any button brings it back
#
# Privacy: the hook sees every key pressed in this session, as any keyboard
# hook does. It reports only the keys listed above, by name, and for typing
# on a real keyboard only *that* it happened. Nothing else leaves this process.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$refs = @([System.Windows.Automation.AutomationElement].Assembly.Location,
          [System.Windows.Automation.ControlType].Assembly.Location)
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Threading;
using System.Windows.Automation;
namespace WinTV {
    public static class Input {
        // ------------------------------------------------------------ win32
        [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vk, scan, flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
        delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
        [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
        const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;
        // Marks the keys this process types, so the hook lets them through untouched.
        static readonly IntPtr OURS = new IntPtr(0x57544E56); // "WTNV"

        const int VK_BACK = 0x08, VK_TAB = 0x09, VK_RETURN = 0x0D, VK_ESCAPE = 0x1B,
                  VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28,
                  VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_H = 0x48,
                  VK_BROWSER_BACK = 0xA6, VK_BROWSER_HOME = 0xAC, VK_F11 = 0x7A, VK_L = 0x4C,
                  VK_VOLUME_MUTE = 0xAD, VK_VOLUME_DOWN = 0xAE, VK_VOLUME_UP = 0xAF;

        // ------------------------------------------------------------ output
        static TextWriter output;
        public static void Line(string json) { output.WriteLine(json); output.Flush(); }
        static void Key(string k, bool down, bool repeat) {
            Line("{\"ev\":\"key\",\"k\":\"" + k + "\",\"down\":" + (down ? "true" : "false") + ",\"repeat\":" + (repeat ? "true" : "false") + "}");
        }

        // ------------------------------------------------------------ hook
        static HookProc proc;           // kept referenced, or the GC frees it under Windows' feet
        static volatile bool grab;
        static long grabUsed;           // last time a grabbed key arrived (ticks)
        static readonly bool[] held = new bool[256];
        static int homeVk;              // which key started the current Home press (0 = none)
        static bool winAlone;           // the Windows key is down and nothing else was pressed with it
        static bool sawRemote, sawKeyboard;

        // Which kind of device is in use, said once each (WinTV shows how to
        // use it): a remote has Home, Back, volume or media keys; a keyboard
        // has letters and the Windows key. Arrows alone could be either.
        static void Seen(uint vk) {
            bool remote = vk == VK_BROWSER_HOME || vk == VK_BROWSER_BACK || (vk >= 0xAD && vk <= 0xB3);
            bool keyboard = vk == VK_LWIN || vk == VK_RWIN || (vk >= 0x41 && vk <= 0x5A);
            if (remote && !sawRemote) { sawRemote = true; Line("{\"ev\":\"device\",\"kind\":\"remote\"}"); }
            if (keyboard && !sawKeyboard) { sawKeyboard = true; Line("{\"ev\":\"device\",\"kind\":\"keyboard\"}"); }
        }
        static long winAt;
        static long lastTyping;
        static Timer grabTimer;

        public static bool Start() {
            output = TextWriter.Synchronized(Console.Out);
            var ready = new ManualResetEvent(false);
            bool ok = false;
            var t = new Thread(() => {
                proc = Hook;
                ok = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0) != IntPtr.Zero;
                ready.Set();
                MSG m;
                while (ok && GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
            });
            t.IsBackground = true;
            t.Start();
            ready.WaitOne();
            grabTimer = new Timer(_ => CheckGrab(), null, 5000, 5000);
            return ok;
        }

        public static void SetGrab(bool on) { grab = on; grabUsed = DateTime.UtcNow.Ticks; }

        // A grab nobody has used for two minutes is dropped, so a stuck
        // system layer can't eat the remote.
        static void CheckGrab() {
            if (grab && DateTime.UtcNow.Ticks - grabUsed > TimeSpan.FromMinutes(2).Ticks) {
                grab = false;
                Line("{\"ev\":\"grab-expired\"}");
            }
        }

        static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

        static string Grabbed(uint vk) {
            switch ((int)vk) {
                case VK_LEFT: return "left";
                case VK_RIGHT: return "right";
                case VK_UP: return "up";
                case VK_DOWN: return "down";
                case VK_RETURN: return "ok";
                case VK_ESCAPE: case VK_BROWSER_BACK: case VK_BACK: return "back";
            }
            return null;
        }

        static bool Printable(uint vk) {
            return vk == 0x20 || (vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5A)
                || (vk >= 0xBA && vk <= 0xC0) || (vk >= 0xDB && vk <= 0xDF) || vk == 0xE2;
        }

        static IntPtr Hook(int code, IntPtr wParam, IntPtr lParam) {
            if (code < 0) return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
            try {
                var k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                if (k.extra == OURS || k.vk > 255) return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
                int msg = wParam.ToInt32();
                bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                if (!down && msg != WM_KEYUP && msg != WM_SYSKEYUP) return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
                bool repeat = down && held[k.vk];
                held[k.vk] = down;
                if (down && !repeat) Seen(k.vk);

                // The Windows key on its own is Home on a keyboard (the TV has no
                // Start menu): tap = home screen, hold = quick settings, told apart
                // when it is let go (600 ms, as main.js's HOLD_MS). Pressed with
                // another key it stays Windows' (Win+L still locks).
                if (k.vk == VK_LWIN || k.vk == VK_RWIN) {
                    if (down && !repeat) { winAlone = true; winAt = DateTime.UtcNow.Ticks; }
                    else if (!down && winAlone) {
                        winAlone = false;
                        if (DateTime.UtcNow.Ticks - winAt < TimeSpan.FromMilliseconds(600).Ticks) { Key("home", true, false); Key("home", false, false); }
                        else Key("quick", true, false);
                    }
                    return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
                }
                if (down) winAlone = false;

                // Home: the remote's Home key, or Win+Esc / Ctrl+Alt+H on a keyboard.
                // Down and up both go out; main.js tells a tap (home) from a hold (quick settings).
                bool homeCombo = (k.vk == VK_ESCAPE && (Down(VK_LWIN) || Down(VK_RWIN)))
                              || (k.vk == VK_H && Down(VK_CONTROL) && Down(VK_MENU));
                if (k.vk == VK_BROWSER_HOME || (down && homeCombo) || (!down && homeVk == (int)k.vk)) {
                    if (down && !repeat) homeVk = (int)k.vk;
                    if (!down) homeVk = 0;
                    Key("home", down, repeat);
                    return (IntPtr)1;
                }
                if (homeVk == (int)k.vk && down) { Key("home", true, true); return (IntPtr)1; }

                // Volume: without Explorer nothing in Windows acts on these keys.
                if (k.vk == VK_VOLUME_UP || k.vk == VK_VOLUME_DOWN || k.vk == VK_VOLUME_MUTE) {
                    if (down) Key(k.vk == VK_VOLUME_UP ? "volup" : k.vk == VK_VOLUME_DOWN ? "voldown" : "mute", true, repeat);
                    return (IntPtr)1;
                }

                // While the system layer is up, the remote drives it, not the app.
                if (grab) {
                    string name = Grabbed(k.vk);
                    bool modifier = Down(VK_CONTROL) || Down(VK_MENU) || Down(VK_LWIN) || Down(VK_RWIN);
                    if (name != null && !modifier) {
                        grabUsed = DateTime.UtcNow.Ticks;
                        if (down) Key(name, true, repeat);
                        return (IntPtr)1;
                    }
                    // Typing on a real keyboard: say so (not what), at most once a second.
                    if (down && Printable(k.vk) && DateTime.UtcNow.Ticks - lastTyping > TimeSpan.TicksPerSecond) {
                        lastTyping = DateTime.UtcNow.Ticks;
                        Line("{\"ev\":\"hwtype\"}");
                    }
                }
            } catch { /* never block input because of our own bug */ }
            return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        // ------------------------------------------------------------ typing
        static INPUT KeyInput(ushort vk, ushort scan, uint flags) {
            var i = new INPUT { type = 1 };
            i.u.ki = new KEYBDINPUT { vk = vk, scan = scan, flags = flags, extra = OURS };
            return i;
        }

        static void Send(INPUT[] list) {
            if (list.Length == 0) return;
            uint sent = SendInput((uint)list.Length, list, Marshal.SizeOf(typeof(INPUT)));
            if (sent != list.Length) throw new InvalidOperationException("Windows did not accept the typing (" + Marshal.GetLastWin32Error() + ")");
        }

        // Each UTF-16 unit as a Unicode keystroke: the app receives the
        // character itself, whatever keyboard layout Windows has set.
        public static void Type(string text) {
            var list = new INPUT[text.Length * 2];
            for (int i = 0; i < text.Length; i++) {
                list[i * 2] = KeyInput(0, text[i], KEYEVENTF_UNICODE);
                list[i * 2 + 1] = KeyInput(0, text[i], KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
            }
            Send(list);
        }

        public static void Press(string name) {
            int vk; uint ext = 0;
            switch (name) {
                case "backspace": vk = VK_BACK; break;
                case "enter": vk = VK_RETURN; break;
                case "tab": vk = VK_TAB; break;
                case "left": vk = VK_LEFT; ext = KEYEVENTF_EXTENDEDKEY; break;
                case "right": vk = VK_RIGHT; ext = KEYEVENTF_EXTENDEDKEY; break;
                case "up": vk = VK_UP; ext = KEYEVENTF_EXTENDEDKEY; break;
                case "down": vk = VK_DOWN; ext = KEYEVENTF_EXTENDEDKEY; break;
                case "escape": vk = VK_ESCAPE; break;
                case "browserback": vk = VK_BROWSER_BACK; ext = KEYEVENTF_EXTENDEDKEY; break;
                case "f11": vk = VK_F11; break; // the app's full screen, on or off
                case "address": // Ctrl+L: the browser's address bar
                    Send(new[] { KeyInput(VK_CONTROL, 0, 0), KeyInput(VK_L, 0, 0), KeyInput(VK_L, 0, KEYEVENTF_KEYUP), KeyInput(VK_CONTROL, 0, KEYEVENTF_KEYUP) });
                    return;
                default: throw new ArgumentException("unknown key " + name);
            }
            Send(new[] { KeyInput((ushort)vk, 0, ext), KeyInput((ushort)vk, 0, ext | KEYEVENTF_KEYUP) });
        }

        // The mouse wheel, as a touchpad swipe scrolls a page (D-45).
        public static void Wheel(int notches) {
            var i = new INPUT { type = 0 };
            i.u.mi = new MOUSEINPUT { data = unchecked((uint)(notches * 120)), flags = 0x0800 /* MOUSEEVENTF_WHEEL */, extra = OURS };
            Send(new[] { i });
        }

        // Picture off: the same message Windows sends when the screen times out.
        public static void ScreenOff() {
            IntPtr r;
            SendMessageTimeout(new IntPtr(0xFFFF), 0x0112 /* WM_SYSCOMMAND */, new IntPtr(0xF170) /* SC_MONITORPOWER */,
                new IntPtr(2), 0x2 /* SMTO_ABORTIFHUNG */, 1000, out r);
        }

        // ------------------------------------------------------------ text fields
        // UI Automation is how screen readers and Windows' touch keyboard learn
        // that a text field has the focus. WinTV's keyboard uses it the same way:
        // focus events for speed, plus a look once a second, because a page that
        // focuses its field while loading doesn't always announce it (seen with
        // Brave on the VM). Only changes are reported: a new field, or none.
        static string lastText = "";
        static readonly object focusLock = new object();
        static Timer focusTimer;

        public static bool WatchFocus() {
            try {
                Automation.AddAutomationFocusChangedEventHandler((src, e) => Report(src as AutomationElement));
                focusTimer = new Timer(_ => { try { Report(AutomationElement.FocusedElement); } catch { } }, null, 1000, 1000);
                return true;
            } catch { return false; }
        }

        static void Report(AutomationElement el) {
            if (el == null) return;
            try {
                var c = el.Current;
                bool text = false;
                if ((c.ControlType == ControlType.Edit || c.ControlType == ControlType.ComboBox) && c.IsKeyboardFocusable && c.IsEnabled) {
                    object p;
                    text = c.ControlType == ControlType.Edit;
                    if (el.TryGetCurrentPattern(ValuePattern.Pattern, out p)) text = !((ValuePattern)p).Current.IsReadOnly;
                }
                // Which field: its runtime id, so typing (which re-announces the
                // same field) isn't mistaken for a new one.
                string field = text ? string.Join(".", el.GetRuntimeId()) : "";
                string now = text ? "{\"ev\":\"text\",\"on\":true,\"password\":" + (c.IsPassword ? "true" : "false") + ",\"pid\":" + c.ProcessId + "}"
                                  : "{\"ev\":\"text\",\"on\":false,\"pid\":" + c.ProcessId + "}";
                lock (focusLock) {
                    string key = text ? field + now : "off";
                    if (key == lastText) return;
                    lastText = key;
                }
                Line(now);
            } catch { /* the element went away while we asked */ }
        }
    }

    // ------------------------------------------------------------ PlayStation controllers (D-45)
    // DualSense and DualShock 4, over USB or Bluetooth, read straight from
    // their HID reports: Windows has no XInput for them, so nothing else turns
    // them into keys outside a game. Out (one JSON line each):
    //   {"ev":"pad","b":"up","down":true,"repeat":false}   up|down|left|right (d-pad or left stick),
    //        ok (cross), back (circle), menu (triangle), options, create, home (PS), l1, r1, l2, r2
    //   {"ev":"pad","b":"swipe","dx":0,"dy":1}            a finger moved on the touchpad (one step)
    //   {"ev":"pad-open","name":"DualSense","bt":true}     a controller was opened (so the home screen
    //                                                     leaves it to this reader)
    public static class Pads {
        [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
        [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES a);
        [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr data);
        [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr data);
        [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data, out HIDP_CAPS caps);
        [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetFeature(SafeFileHandle h, byte[] buffer, int length);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr enumerator, IntPtr hwnd, int flags);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr devInfo, ref Guid g, int index, ref SP_DEVICE_INTERFACE_DATA data);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, IntPtr devInfo);
        [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle h, byte[] buffer, int length, out int read, IntPtr overlapped);

        [StructLayout(LayoutKind.Sequential)] struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID, ProductID, VersionNumber; }
        [StructLayout(LayoutKind.Sequential)] struct HIDP_CAPS {
            public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices,
                NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices, NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
        }
        [StructLayout(LayoutKind.Sequential)] struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }

        const ushort SONY = 0x054C;
        static readonly Dictionary<ushort, string> Models = new Dictionary<ushort, string> {
            { 0x0CE6, "DualSense" }, { 0x0DF2, "DualSense Edge" }, { 0x05C4, "DualShock 4" }, { 0x09CC, "DualShock 4" }, { 0x0BA0, "DualShock 4" },
        };
        static readonly HashSet<string> open = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static Timer scanTimer;

        public static void Start() {
            scanTimer = new Timer(_ => Scan(), null, 1000, 3000);   // a controller can be switched on at any time
        }

        static IEnumerable<string> HidPaths() {
            Guid g; HidD_GetHidGuid(out g);
            IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x2 | 0x10);   // present, interfaces
            var paths = new List<string>();
            if (set == new IntPtr(-1)) return paths;
            try {
                var d = new SP_DEVICE_INTERFACE_DATA { cbSize = Marshal.SizeOf(typeof(SP_DEVICE_INTERFACE_DATA)) };
                for (int i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d); i++) {
                    int need;
                    SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
                    if (need <= 0) continue;
                    IntPtr buf = Marshal.AllocHGlobal(need);
                    try {
                        Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);   // cbSize of SP_DEVICE_INTERFACE_DETAIL_DATA_W
                        if (SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero))
                            paths.Add(Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4)));
                    } finally { Marshal.FreeHGlobal(buf); }
                }
            } finally { SetupDiDestroyDeviceInfoList(set); }
            return paths;
        }

        static void Scan() {
            try {
                foreach (string path in HidPaths()) {
                    lock (open) { if (open.Contains(path)) continue; }
                    // Read and write (the write is only for the Bluetooth feature report); shared, as games read it too.
                    var h = CreateFile(path, 0xC0000000, 0x3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                    if (h.IsInvalid) h = CreateFile(path, 0x80000000, 0x3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                    if (h.IsInvalid) continue;
                    var a = new HIDD_ATTRIBUTES { Size = Marshal.SizeOf(typeof(HIDD_ATTRIBUTES)) };
                    string model;
                    if (!HidD_GetAttributes(h, ref a) || a.VendorID != SONY || !Models.TryGetValue(a.ProductID, out model)) { h.Dispose(); continue; }
                    int length = 64;
                    IntPtr pre;
                    if (HidD_GetPreparsedData(h, out pre)) {
                        HIDP_CAPS caps;
                        if (HidP_GetCaps(pre, out caps) == 0x110000 /* HIDP_STATUS_SUCCESS */) length = caps.InputReportByteLength;
                        HidD_FreePreparsedData(pre);
                    }
                    if (length < 10) { h.Dispose(); continue; }       // another of its interfaces (audio, etc.)
                    bool ds5 = model.StartsWith("DualSense");
                    bool bt = length > 64;                              // USB reports are 64 bytes
                    if (bt) {
                        // Over Bluetooth both send short reports until a calibration
                        // feature report is read; after that, full ones with the touchpad.
                        var f = new byte[ds5 ? 41 : 37];
                        f[0] = (byte)(ds5 ? 0x05 : 0x02);
                        HidD_GetFeature(h, f, f.Length);
                    }
                    lock (open) open.Add(path);
                    Input.Line("{\"ev\":\"pad-open\",\"name\":\"" + model + "\",\"bt\":" + (bt ? "true" : "false") + "}");
                    var reader = new Thread(() => Read(path, h, length, ds5));
                    reader.IsBackground = true;
                    reader.Start();
                }
            } catch { /* never let the scan stop the helper */ }
        }

        // ------------------------------------------------------------ reports
        class State {
            public bool[] dir = new bool[4];                  // up, down, left, right as last sent
            public long[] since = new long[4], last = new long[4];
            public int buttons = -1;                          // last button bits (b0 face + b1 + b2 << 16)
            public bool touching; public int tx, ty, ax, ay;  // finger 1: where, and how far moved
            public int axisLock;                              // 0 none, 1 vertical, 2 horizontal (per touch)
            public int sx, sy;                                // left stick: -1, 0 or 1 (with a dead band)
        }
        static readonly string[] DirNames = { "up", "down", "left", "right" };

        static void Read(string path, SafeFileHandle h, int length, bool ds5) {
            var buf = new byte[length];
            var s = new State();
            var repeat = new Timer(_ => Repeat(s), null, 50, 50);
            try {
                int n;
                while (ReadFile(h, buf, length, out n, IntPtr.Zero) && n > 0) {
                    try { Report(buf, n, ds5, s); } catch { }
                }
            } finally {
                repeat.Dispose();
                h.Dispose();
                lock (s) for (int i = 0; i < 4; i++) if (s.dir[i]) { s.dir[i] = false; Pad(DirNames[i], false, false); }
                lock (open) open.Remove(path);                 // switched off or out of range: found again later
            }
        }

        static void Report(byte[] r, int n, bool ds5, State s) {
            int o, b0, b1, b2, touchAt;
            if (ds5 && r[0] == 0x01 && n >= 64) { o = 1; b0 = r[o + 7]; b1 = r[o + 8]; b2 = r[o + 9]; touchAt = o + 32; }        // USB
            else if (ds5 && r[0] == 0x31 && n >= 46) { o = 2; b0 = r[o + 7]; b1 = r[o + 8]; b2 = r[o + 9]; touchAt = o + 32; }   // Bluetooth, full
            else if (!ds5 && r[0] == 0x11 && n >= 45) { o = 3; b0 = r[o + 4]; b1 = r[o + 5]; b2 = r[o + 6]; touchAt = o + 34; }  // DS4 Bluetooth, full
            else if (r[0] == 0x01 && n >= 10) {                                                                                  // DS4 USB, or the short Bluetooth report
                o = 1; b0 = r[o + 4]; b1 = r[o + 5]; b2 = r[o + 6];
                touchAt = !ds5 && n >= 64 ? o + 34 : -1;
            } else return;
            lock (s) {
                // Directions: the d-pad's hat, or the left stick past a dead band.
                int hat = b0 & 0x0F;
                s.sx = Axis(r[o], s.sx);
                s.sy = Axis(r[o + 1], s.sy);
                bool[] now = {
                    hat == 7 || hat == 0 || hat == 1 || s.sy < 0,
                    hat == 3 || hat == 4 || hat == 5 || s.sy > 0,
                    hat == 5 || hat == 6 || hat == 7 || s.sx < 0,
                    hat == 1 || hat == 2 || hat == 3 || s.sx > 0,
                };
                long t = DateTime.UtcNow.Ticks;
                for (int i = 0; i < 4; i++) {
                    if (now[i] == s.dir[i]) continue;
                    s.dir[i] = now[i];
                    s.since[i] = s.last[i] = t;
                    Pad(DirNames[i], now[i], false);
                }
                // Buttons: each change, once.
                int bits = (b0 & 0xF0) | (b1 << 8) | ((b2 & 0x03) << 16);
                if (s.buttons >= 0) {
                    int changed = bits ^ s.buttons;
                    Button(changed, bits, 0x20, "ok"); Button(changed, bits, 0x40, "back"); Button(changed, bits, 0x80, "menu");
                    Button(changed, bits, 0x100, "l1"); Button(changed, bits, 0x200, "r1"); Button(changed, bits, 0x400, "l2"); Button(changed, bits, 0x800, "r2");
                    Button(changed, bits, 0x1000, "create"); Button(changed, bits, 0x2000, "options"); Button(changed, bits, 0x10000, "home");
                }
                s.buttons = bits;
                // Touchpad, first finger: steps of 80 (of 1920 x 1080), along the
                // axis the finger started out on.
                if (touchAt >= 0 && touchAt + 3 < n) {
                    bool touching = (r[touchAt] & 0x80) == 0;
                    int x = r[touchAt + 1] | ((r[touchAt + 2] & 0x0F) << 8);
                    int y = (r[touchAt + 2] >> 4) | (r[touchAt + 3] << 4);
                    if (touching && s.touching) {
                        s.ax += x - s.tx; s.ay += y - s.ty;
                        if (s.axisLock == 0 && Math.Abs(s.ax) + Math.Abs(s.ay) > 40) s.axisLock = Math.Abs(s.ay) >= Math.Abs(s.ax) ? 1 : 2;
                        while (s.axisLock == 1 && Math.Abs(s.ay) >= 80) { int d = Math.Sign(s.ay); s.ay -= d * 80; Swipe(0, d); }
                        while (s.axisLock == 2 && Math.Abs(s.ax) >= 80) { int d = Math.Sign(s.ax); s.ax -= d * 80; Swipe(d, 0); }
                    } else if (touching) { s.ax = s.ay = 0; s.axisLock = 0; }
                    s.touching = touching; s.tx = x; s.ty = y;
                }
            }
        }

        // -1, 0 or 1, entering past 48 from the centre (128) and leaving below 80.
        static int Axis(int v, int was) {
            int d = v - 128;
            if (Math.Abs(d) > 80) return Math.Sign(d);
            if (Math.Abs(d) < 48) return 0;
            return was;
        }

        static void Button(int changed, int bits, int mask, string name) {
            if ((changed & mask) != 0) Pad(name, (bits & mask) != 0, false);
        }

        // A held direction repeats like a key: after 0.4 s, then every 0.11 s.
        static void Repeat(State s) {
            lock (s) {
                long t = DateTime.UtcNow.Ticks;
                for (int i = 0; i < 4; i++) {
                    if (!s.dir[i] || t - s.since[i] < TimeSpan.FromMilliseconds(400).Ticks || t - s.last[i] < TimeSpan.FromMilliseconds(110).Ticks) continue;
                    s.last[i] = t;
                    Pad(DirNames[i], true, true);
                }
            }
        }

        static void Pad(string b, bool down, bool repeat) {
            Input.Line("{\"ev\":\"pad\",\"b\":\"" + b + "\",\"down\":" + (down ? "true" : "false") + ",\"repeat\":" + (repeat ? "true" : "false") + "}");
        }

        static void Swipe(int dx, int dy) {
            Input.Line("{\"ev\":\"pad\",\"b\":\"swipe\",\"down\":true,\"dx\":" + dx + ",\"dy\":" + dy + "}");
        }
    }
}
'@

$hook = [WinTV.Input]::Start()
$uia = [WinTV.Input]::WatchFocus()
[WinTV.Pads]::Start()
[WinTV.Input]::Line((ConvertTo-Json -Compress -InputObject @{ ev = 'ready'; hook = $hook; uia = $uia }))

while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
        $req = $line | ConvertFrom-Json
        switch ($req.op) {
            'grab'       { [WinTV.Input]::SetGrab([bool]$req.on) }
            'type'       { [WinTV.Input]::Type([string]$req.text) }
            'key'        { [WinTV.Input]::Press([string]$req.key) }
            'wheel'      { [WinTV.Input]::Wheel([int]$req.notches) }
            'screen-off' { [WinTV.Input]::ScreenOff() }
            default      { throw "unknown op '$($req.op)'" }
        }
    } catch {
        [WinTV.Input]::Line((ConvertTo-Json -Compress -InputObject @{ ev = 'error'; message = $_.Exception.Message }))
    }
}
