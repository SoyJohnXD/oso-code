@echo off
REM oso-code Windows entry point. Double-click me, or run me from a terminal.
REM All logic lives in install.ps1 and, ultimately, install.sh — this only hands
REM off with an execution policy that lets the unsigned local script run.
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "exit_code=%ERRORLEVEL%"

REM Explorer launches a double-clicked .bat via `cmd /c`, so its command line
REM names this file; a terminal invocation does not. Pause only in the first case
REM so the window does not vanish before the operator can read the output.
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause

exit /b %exit_code%
