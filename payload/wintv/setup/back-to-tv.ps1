# WinTV, as SYSTEM right after someone signs out (task \WinTV\BackToTV, on
# Winlogon's sign-out event 7002). When the admin signs out of the Windows
# desktop (Settings > Admin > Windows desktop, D-39), Windows shows its
# sign-in screen with Admin picked, which a TV remote can't get past (it has
# no Tab key). The tv account has no password and its session is still
# running in the background, so it goes back on the screen, where it was
# (D-41). Nothing happens if someone is signed in on the screen, or if there
# is no tv session.
. "$PSScriptRoot\common.ps1"
$Stage = 'back-to-tv'
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace WinTV {
public static class Sessions {
    [DllImport("kernel32.dll")]
    public static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr info, out int count);
    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool WTSQuerySessionInformation(IntPtr server, int session, int infoClass, out IntPtr buffer, out int bytes);
    [DllImport("wtsapi32.dll")]
    static extern void WTSFreeMemory(IntPtr p);
    [StructLayout(LayoutKind.Sequential)]
    struct SessionInfo { public int SessionId; public IntPtr WinStationName; public int State; }

    // The account signed in to a session ("" for the sign-in screen).
    public static string User(int id) {
        IntPtr b; int n;
        if (!WTSQuerySessionInformation(IntPtr.Zero, id, 5 /* WTSUserName */, out b, out n)) return "";
        try { return Marshal.PtrToStringUni(b) ?? ""; } finally { WTSFreeMemory(b); }
    }

    public static int[] Of(string user) {
        IntPtr info; int count;
        var ids = new List<int>();
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out info, out count)) return ids.ToArray();
        try {
            int size = Marshal.SizeOf(typeof(SessionInfo));
            for (int i = 0; i < count; i++) {
                var s = (SessionInfo)Marshal.PtrToStructure(new IntPtr(info.ToInt64() + i * size), typeof(SessionInfo));
                if (string.Equals(User(s.SessionId), user, StringComparison.OrdinalIgnoreCase)) ids.Add(s.SessionId);
            }
        } finally { WTSFreeMemory(info); }
        return ids.ToArray();
    }
}
}
'@

Invoke-Step 'back to the TV after a sign-out' {
    Start-Sleep -Seconds 4   # the sign-out finishes and the sign-in screen comes up
    $console = [int][WinTV.Sessions]::WTSGetActiveConsoleSessionId()
    $user = [WinTV.Sessions]::User($console)
    if ($user) { Write-Log "  $user is signed in on the screen: nothing to do"; return }
    $tv = @([WinTV.Sessions]::Of('tv'))
    if (-not $tv.Count) { Write-Log '  no tv session to bring back'; return }
    Invoke-Native "$env:SystemRoot\System32\tscon.exe" @("$($tv[0])", '/dest:console') | Out-Null
}
