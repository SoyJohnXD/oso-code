@echo off
setlocal

set "HOME=%USERPROFILE:\=/%"

where node >nul 2>&1 || goto :no_node
node "%~dp0oso.js" verify --host claude
set "exit_code=%ERRORLEVEL%"
goto :report_done

:no_node
echo [oso-code] cannot verify: no node on this machine, and the verifier runs on
echo [oso-code] Node.js 22 or newer. Install it from https://nodejs.org, or run:
echo [oso-code]   winget install --id OpenJS.NodeJS.LTS --exact --scope user
set "exit_code=1"

:report_done
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause

exit /b %exit_code%
