@echo off
setlocal
if not exist "%~dp0Moshu.exe" (
  echo Keep this file beside Moshu.exe in the complete extracted program folder.
  pause
  exit /b 1
)
start "" /D "%~dp0" "%~dp0Moshu.exe" --disable-gpu
endlocal
