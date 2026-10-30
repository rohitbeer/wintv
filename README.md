# WinTV

A TV edition of Windows 11. Plug a PC into the TV, install from a USB
stick, and it boots straight to a "Who's watching?" screen, then an
Apple-TV-style home screen. It has no Microsoft bloat and no Edge, and uses
Brave as the browser. WinTV's own shell replaces every Windows screen the TV
account would see (D-22). Over every app it adds quick settings, an
on-screen keyboard and the volume. The Windows desktop exists only in a
hidden repair mode for the admin.

- Why each choice was made: `decision.md`
- The concepts, explained: `docs/EXPLANATIONS.md`
- Why not on the TV's own Android chip: `docs/feasibility-android-tv.md`
- What other TV systems offer, and WinTV's roadmap: `docs/tv-os-parity.md` (D-21)
- `WTV-n` numbers in the docs are tickets in the project's tracker.

## Layout

| path | what |
|---|---|
| `shell/` | the WinTV shell (Electron), in place of Explorer. `main.js` = windows, apps, power, sleep timer; `input.ps1` = the remote's Home/volume keys and the keyboard's typing; `system.ps1` = what Settings may change in Windows; `ui/index.html` = home screen, Settings, "Who's watching?", clock screen; `ui/layer.html` = the system layer over every app (quick settings, keyboard, volume); `apps.default.json` = apps, profiles, keys |
| `sites/<household>.json` | a household's changes (profiles, extra tiles) merged over the defaults |
| `payload/wintv/setup/` | what Windows runs during setup: `specialize.ps1`, `keep-apps.txt`, policies, first-logon and boot scripts |
| `build/build-payload.sh` | builds the payload (build container) |
| `build/autounattend.xml.in` | the answer file template |
| `vm/` | host scripts: `make-iso.sh`, `create-vm.sh`, `deploy-shell.sh`, `shot.sh`, `gx.sh`, firewall `222.fw` |
| `docs/evidence/rea/` | raw REA output behind the feasibility study |

## Build and test (on the Proxmox host)

Copy `vm/` to the Proxmox host and run the scripts there.

```
vm/make-iso.sh vm          # payload + answer file -> local:iso/wintv-payload-vm.iso
vm/create-vm.sh --fresh    # VM 222 wintv-test, unattended install
vm/deploy-shell.sh         # fast loop: rebuild, copy the shell into the VM, restart
vm/shot.sh /tmp/tv.png     # screenshot of the VM (doesn't disturb Windows' focus)
echo 'sendkey ac_home 900' | qm monitor 222   # remote keys: ac_home (hold 900 ms), volumeup, ret, esc, arrows
vm/gx.sh 'Get-Content C:\ProgramData\WinTV\setup.log'   # PowerShell inside the VM
```

Admin password: in a private file kept by the builder. It is also inside
the payload ISO's `autounattend.xml` (the ISO is mode 600).

## Real PC (usb variant)

1. Write the official Windows 11 ISO to a USB stick (Rufus, or `dd` of a
   hybrid image).
2. `make-iso.sh usb`, then copy `autounattend.xml` and `wintv/` from that
   ISO to the root of the stick.
3. Boot the PC from the stick. Setup asks only which disk to use.

This path is not hardware-tested yet (WTV-15).

## Using it

| remote / controller | does |
|---|---|
| arrows / d-pad / left stick | move |
| Enter / A | open |
| hold Enter / Y / Menu | app menu (quit a running app) |
| Back, Esc / B | back |
| Home (`BrowserHome`, Win+Esc, Ctrl+Alt+H) | back to the home screen, from any app |
| hold Home (or Ctrl+Alt+Q) | quick settings, over any app: volume, mute, sleep timer, keyboard, picture off, who's watching |
| volume up / down / mute | volume, shown over any app |
| a text field gets the focus | the on-screen keyboard comes up (arrows + OK to type, Back to hide) |
| Power tile | sleep, restart, shut down, switch profile |
| any button on the clock screen | wake the TV (after a long break it asks "Who's watching?") |
| Settings > About, OK seven times on "WinTV" | Repair mode: Windows' sign-in for the admin, then the desktop |

## After installing

Edge's uninstaller only accepts Settings, not a script (D-17). Once, as
admin: Settings > About > Repair mode (press OK seven times on "WinTV" to
show it), sign in as admin, then **Settings > Apps > Installed apps >
Microsoft Edge > Uninstall**. Then sign out and choose **TV**.
