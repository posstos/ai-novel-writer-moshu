@echo off
setlocal DisableDelayedExpansion
title Moshu - Local Launcher
if not exist "%~dp0scripts\start-local-windows.ps1" (
  echo [ERROR] Missing scripts\start-local-windows.ps1
  echo Keep this launcher in the same folder as package.json.
  pause
  exit /b 1
)
if /i "%~1"=="/check" goto check
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-windows.ps1"
set "launcher_exit=%errorlevel%"
echo.
if not "%launcher_exit%"=="0" echo [ERROR] Startup stopped. Read the message and the log path above.
echo Press any key to close this window.
pause >nul
exit /b %launcher_exit%
:check
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-windows.ps1" -CheckOnly
exit /b %errorlevel%
