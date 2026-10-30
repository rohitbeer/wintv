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
| `shell/` | the WinTV shell (Electron), in place of Explorer. `main.js` = windows, apps, power, sleep timer; `input.ps1` = the remote's Home/volume keys and the keyboard's typing; `system.ps1` = what Settings may change in Windows; `ui/index.html` = home screen, Settings, "Who's watching?", clock screen; `ui/layer.html` = the system layer over every app (quick settings, keyboard, volume); `ui/prefs.js` + `ui/access.css` = text size, contrast, reduce motion and sounds for both; `apps.default.json` = apps, profiles, keys |
| `sites/example.json` | example household site file: profiles, extra tiles, language and time zone. Your own copy stays outside the repo |
| `payload/wintv/setup/` | what Windows runs during setup: `specialize.ps1`, `keep-apps.txt`, policies, first-logon and boot scripts |
| `build/build-payload.sh` | builds the payload (Linux, in the build container) |
| `build/autounattend.xml.in` | the answer file template |
| `vm/` | Proxmox host scripts: `make-iso.sh`, `create-vm.sh`, `deploy-shell.sh`, `shot.sh`, `gx.sh`; settings in `local.env` (`local.env.example`), test-VM firewall `firewall.example.fw` |
| `docs/evidence/rea/` | raw REA output behind the feasibility study |

## Build and test (on a Proxmox host)

The payload is built in a Linux container (Node.js, `gh`, `bsdtar`) and
tested in a Windows VM. Copy `vm/` to the host, fill in `vm/local.env` from
`local.env.example` (build container, admin-password file, your site file,
test-VM firewall), then:

```
vm/make-iso.sh vm          # payload + answer file -> local:iso/wintv-payload-vm.iso
vm/create-vm.sh --fresh    # test VM (ID 222 unless ID=...), unattended install
vm/deploy-shell.sh         # fast loop: rebuild, copy the shell into the VM, restart
vm/shot.sh /tmp/tv.png     # screenshot of the VM (doesn't disturb Windows' focus)
echo 'sendkey ac_home 900' | qm monitor 222   # remote keys: ac_home (hold 900 ms), volumeup, ret, esc, arrows
vm/gx.sh 'Get-Content C:\ProgramData\WinTV\setup.log'   # PowerShell inside the VM
```

The admin password is generated into the file `WINTV_SECRET` names, and is
also inside the payload ISO's `autounattend.xml` (the ISO is mode 600).
Nothing personal belongs in the repo: names, addresses and passwords live in
`local.env` and your site file, both outside git.

## Installing on a PC (usb variant)

WinTV is a folder and an answer file that sit next to Microsoft's own,
unmodified Windows 11 installer (D-2). The disk you pick is erased.

1. Download the Windows 11 ISO from Microsoft and write it to a USB stick
   (Rufus on Windows: turn off its own "customize Windows" options, WinTV's
   answer file does that).
2. Make your site file from `sites/example.json` (names, extra tiles,
   language, time zone), point `WINTV_SITE` at it, and run
   `vm/make-iso.sh usb`. Copy `autounattend.xml` and the `wintv` folder
   from the resulting `wintv-payload-usb.iso` to the root of the stick.
3. Boot the PC from the stick. Setup asks only which disk to install to,
   then runs by itself (about 20 to 40 minutes, several restarts) and ends
   on "Who's watching?". Windows Pro activates itself with the key most
   PCs carry in their firmware.
4. Once, remove Edge (see After installing).

The stick holds the admin password in `autounattend.xml`; Windows deletes it
from the installed system. Wipe the stick or keep it safe. This path is not
hardware-tested yet (WTV-15).

## Updates

Settings > Updates shows both kinds (D-27, D-28):

- **Windows:** check and "Install now", as a SYSTEM task the TV may only
  start. Windows installs the same updates by itself anyway.
- **WinTV:** installed TVs check GitHub Releases of this repo daily for a
  newer, signed release, install it next to the running version, and switch
  when no app is open. A release that doesn't start rolls back by itself.

To publish a release, bump `shell/package.json`'s version, commit, and on the
machine with the release key run `vm/release.sh --publish` (it signs the
manifest and attaches `manifest.json`, `manifest.sig` and the zip to
release `vX.Y.Z`).

## Using it

| remote / controller | does |
|---|---|
| arrows / d-pad / left stick | move |
| Enter / A | open |
| hold Enter / Y / Menu | app menu (quit a running app) |
| Back, Esc / B | back |
| Home (`BrowserHome`; on a keyboard the Windows key, Win+Esc or Ctrl+Alt+H) | back to the home screen, from any app |
| hold Home (or the Windows key, or Ctrl+Alt+Q) | quick settings, over any app: volume, mute, sleep timer, keyboard, picture off, who's watching |
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

## License

MIT, see `LICENSE`. WinTV installs third-party software it does not
include in this repository: Windows (Microsoft's own media and licence),
Brave (downloaded and hash-checked at build time) and, in the test VM, the
virtio drivers.
