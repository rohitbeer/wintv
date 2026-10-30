# WinTV

Stock Windows 11 turned into a TV appliance. Plug a PC into the TV, install
from a USB stick, and it boots straight to a "Who's watching?" screen, then
an Apple-TV-style home screen. It has no Microsoft bloat and no Edge, uses
Brave as the browser, and the TV account sees only WinTV's own screens,
Settings included.

- Why each choice was made: `decision.md`
- The concepts, explained: `docs/EXPLANATIONS.md`
- Why not on the TV's own Android chip: `docs/feasibility-android-tv.md`
- `WTV-n` numbers in the docs are tickets in the project's tracker.

## Layout

| path | what |
|---|---|
| `launcher/` | the home screen (Electron). `main.js` = shell + app launching, `system.ps1` = what Settings may change in Windows, `ui/` = the screens, `apps.default.json` = apps and profiles |
| `sites/<household>.json` | a household's changes (profiles, extra tiles) merged over the defaults |
| `payload/wintv/setup/` | what Windows runs during setup: `specialize.ps1`, `keep-apps.txt`, policies, first-logon and boot scripts |
| `build/build-payload.sh` | builds the payload (build container) |
| `build/autounattend.xml.in` | the answer file template |
| `vm/` | host scripts: `make-iso.sh`, `create-vm.sh`, `shot.sh`, `gx.sh`, firewall `222.fw` |
| `docs/evidence/rea/` | raw REA output behind the feasibility study |

## Build and test (on the Proxmox host)

Copy `vm/` to the Proxmox host and run the scripts there.

```
vm/make-iso.sh vm          # payload + answer file -> local:iso/wintv-payload-vm.iso
vm/create-vm.sh --fresh    # VM 222 wintv-test, unattended install
vm/shot.sh /tmp/tv.png     # screenshot of the VM
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
| Home (`BrowserHome`, Ctrl+Esc, Win+Esc, Ctrl+Alt+H) | back to the home screen from any app |
| Power tile | sleep, restart, shut down, switch profile, admin sign-in |
| any button on the clock screen | wake the TV (after a long break it asks "Who's watching?") |

## After installing

Edge's uninstaller only accepts Settings, not a script (D-17). Once, as
admin: Power > Admin Sign-in, then **Settings > Apps > Installed apps >
Microsoft Edge > Uninstall**. Then sign out and choose **TV**.
