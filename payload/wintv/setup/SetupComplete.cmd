@echo off
rem WinTV: runs as SYSTEM after Windows setup, before the first sign-in.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\WinTV\payload\setup\setupcomplete.ps1"
