@echo off
rem WinTV: runs as SYSTEM after OOBE, before the first sign-in.
rem Setup's own autologon expires after one sign-in; make it permanent for tv.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ". 'C:\ProgramData\WinTV\payload\setup\common.ps1'; $Stage='setupcomplete'; Invoke-Step 'permanent autologon for tv' { Set-AutoLogon }"
