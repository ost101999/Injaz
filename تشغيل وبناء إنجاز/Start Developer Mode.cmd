@echo off
setlocal
powershell.exe -NoProfile -File "%~dp0Preview.ps1" %*
set "launch_exit=%errorlevel%"
if not "%launch_exit%"=="0" pause
exit /b %launch_exit%
