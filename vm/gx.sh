#!/usr/bin/env bash
# Run PowerShell inside VM 222 via the QEMU guest agent and print its output.
#   gx.sh 'Get-Content C:\ProgramData\WinTV\setup.log'
ID=${ID:-222}
qm guest exec "$ID" --timeout "${TIMEOUT:-120}" -- powershell.exe -NoProfile -NonInteractive -Command "$1" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.stdout.write(d.get("out-data","")); sys.stderr.write(d.get("err-data","")); sys.exit(d.get("exitcode",0) or 0)'
