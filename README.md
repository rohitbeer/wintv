# WinTV

A Windows 11 build for a PC plugged into a TV. It is fully debloated, has no
Edge, uses Brave, and boots straight into an Apple-TV-style home screen with
a "Who's watching?" sign-in. Why each piece is the way it is: `decision.md`.
The concepts, explained: `docs/EXPLANATIONS.md`.

```
stock Windows 11 ISO ─┐
                      ├─ Windows Setup reads autounattend.xml ─► specialize.ps1 (SYSTEM):
payload ISO / USB ────┘   from the payload                       remove apps, Edge, policies,
  autounattend.xml                                               Brave, launcher, boot task
  wintv/  setup/ launcher/ apps/ config/ [test/]                         │
                                                                         ▼
                              tv signs in by itself ─► WinTV.exe is its shell ─► Who's watching?
```

| path | what |
|---|---|
| `launcher/` | the home screen (Electron). `main.js` starts apps and handles power and profiles. `ui/` is the screen. `apps.default.json` holds the shipped apps and profiles |
| `sites/<household>.json` | a household's changes (profiles, extra tiles), installed as `C:\ProgramData\WinTV\apps.json` |
| `payload/wintv/setup/` | what runs inside Windows: `specialize.ps1`, `keep-apps.txt`, `policies.reg`, `default-user.reg`, `firstlogon.ps1`, `maintain.ps1`, `SetupComplete.cmd` |
| `build/` | `build-payload.sh` (dev container) and the `autounattend.xml.in` template |
| `vm/` | host scripts: `make-iso.sh`, `create-vm.sh`, `shot.sh`, the VM firewall `222.fw` |
| `docs/` | `EXPLANATIONS.md`, `feasibility-android-tv.md` (REA study), `evidence/rea/` |

## Build and test (Proxmox host)

```
vm/make-iso.sh vm        # payload + answer file -> local:iso/wintv-payload-vm.iso
vm/create-vm.sh --fresh  # VM 222: stock Win 11 eval ISO + payload, unattended
vm/shot.sh /tmp/x.png    # screenshot of the VM
qm guest exec 222 -- powershell -c "Get-Content C:\ProgramData\WinTV\setup.log"
```
Copy `vm/` to the Proxmox host to run it.

## On a real PC (variant usb)

1. Write the official **Windows 11** ISO to a USB stick (Rufus, or Microsoft's
   Media Creation Tool).
2. `make-iso.sh usb`, then copy `autounattend.xml` and `wintv/` from the
   payload ISO to the root of the stick.
3. Boot the PC from the stick and pick the disk when asked. The `usb`
   variant never wipes a disk on its own. Everything else is automatic.

Admin account: `admin`, password in a private file kept by the builder.
From the TV: Power → Admin Sign-in.

## Launcher controls

Arrows / d-pad / left stick move. Enter / A opens. Esc / Back / B goes back.
Holding Enter, or pressing Menu / Y / Start, opens the app menu (Quit). Home
(BrowserHome, Ctrl+Esc, Win+Esc, Ctrl+Alt+H, whichever Windows allows)
comes back from any app.
