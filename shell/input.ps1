# WinTV input service: the remote's system keys, for the whole TV account.
# main.js starts it once, as the tv user. Windows normally gives these keys
# to Explorer (Home, volume) or to whichever app is in front; on WinTV the
# shell owns them, in every app, the way a TV's own buttons work.
#
# Out (one JSON object per line):
#   {"ev":"key","k":"home","down":true,"repeat":false}   home | volup | voldown | mute
#   {"ev":"key","k":"left","down":true,"repeat":false}   left|right|up|down|ok|back, only while grabbed
#   {"ev":"text","on":true,"password":false,"pid":123}   a text field got (or lost) the focus, in any app
#   {"ev":"hwtype"}                                       someone typed on a real keyboard (which key is never sent)
#   {"ev":"grab-expired"}                                 nobody used the system layer for 2 minutes
#   {"ev":"ready","hook":true,"uia":true}
# In (one JSON object per line):
#   {"op":"grab","on":true}        arrows/OK/Back go to the system layer instead of the app
#   {"op":"type","text":"abc"}     type into whatever has the focus
#   {"op":"key","key":"backspace"} backspace | enter | left | right | tab
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
using System.IO;
using System.Runtime.InteropServices;
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
                  VK_BROWSER_BACK = 0xA6, VK_BROWSER_HOME = 0xAC,
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
                default: throw new ArgumentException("unknown key " + name);
            }
            Send(new[] { KeyInput((ushort)vk, 0, ext), KeyInput((ushort)vk, 0, ext | KEYEVENTF_KEYUP) });
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
}
'@

$hook = [WinTV.Input]::Start()
$uia = [WinTV.Input]::WatchFocus()
[WinTV.Input]::Line((ConvertTo-Json -Compress -InputObject @{ ev = 'ready'; hook = $hook; uia = $uia }))

while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
        $req = $line | ConvertFrom-Json
        switch ($req.op) {
            'grab'       { [WinTV.Input]::SetGrab([bool]$req.on) }
            'type'       { [WinTV.Input]::Type([string]$req.text) }
            'key'        { [WinTV.Input]::Press([string]$req.key) }
            'screen-off' { [WinTV.Input]::ScreenOff() }
            default      { throw "unknown op '$($req.op)'" }
        }
    } catch {
        [WinTV.Input]::Line((ConvertTo-Json -Compress -InputObject @{ ev = 'error'; message = $_.Exception.Message }))
    }
}
