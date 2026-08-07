@echo off
REM oso-code Windows verifier. Double-click me, or run me from a terminal.
REM install.bat's sibling, and the same window handling: all the logic lives in
REM verify.sh, which is where a report an operator can read has to come from.
setlocal

REM Slice 2's policy, applied at this file's own delegation point the way
REM install.ps1 applies it at its one. Git Bash takes $HOME from an inherited
REM $HOME first, then HOMEDRIVE+HOMEPATH, and only then %USERPROFILE%; the client
REM is a Node process, so os.homedir() - %USERPROFILE%, always - is the only tree
REM it opens. Unpinned, a roaming or HOMESHARE profile or a machine carrying an
REM MSYS2 $HOME of its own sends this verifier into a tree the client never reads,
REM where every check answers about the wrong install and the report is green over
REM nothing. Forward slashes because Git Bash reads a backslash as an escape.
set "HOME=%USERPROFILE:\=/%"

REM Git Bash directly, not through PowerShell: install.bat hands off to
REM install.ps1 because that script provisions the machine before anything can be
REM installed, and there is no such work to do here - one script runs and prints a
REM report. A verify.ps1 in between would be a second Windows entry point to keep
REM ASCII, LF, CR-scanned and parse-checked for nothing but a path lookup cmd can
REM do in three lines.
REM Git's installer puts git.exe on PATH and bash.exe beside it under the install
REM root rather than on PATH itself, so the first candidate is derived from
REM wherever git.exe was found and the other two are the machine-wide and per-user
REM default locations - the same three, in the same order, as Find-GitBash in
REM install.ps1.
set "bash_exe="
for /f "delims=" %%G in ('where git.exe 2^>nul') do (
  if not defined bash_exe if exist "%%~dpG..\bin\bash.exe" set "bash_exe=%%~dpG..\bin\bash.exe"
)
if not defined bash_exe if exist "%ProgramFiles%\Git\bin\bash.exe" set "bash_exe=%ProgramFiles%\Git\bin\bash.exe"
if not defined bash_exe if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "bash_exe=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not defined bash_exe goto :no_bash

REM Forward slashes again, for the reason install.ps1's Get-InstallShPath hands
REM them over: a backslash in an argument is an escape to the shell reading it.
set "script_dir=%~dp0"
set "script_dir=%script_dir:\=/%"
"%bash_exe%" "%script_dir%verify.sh"
set "exit_code=%ERRORLEVEL%"
goto :report_done

REM An unverifiable install is a failure, never a silent skip: this is the same
REM machine state install.ps1 refuses to run against, named the same way.
:no_bash
echo [oso-code] cannot verify: no Git Bash on this machine, and verify.sh is a
echo [oso-code] shell script. Install Git for Windows from
echo [oso-code] https://git-scm.com/download/win, or run:
echo [oso-code]   winget install --id Git.Git --exact --scope user
set "exit_code=1"

:report_done
REM Explorer launches a double-clicked .bat via `cmd /c`, so its command line
REM names this file; a terminal invocation does not. Pause only in the first case
REM so the window does not vanish before the operator can read the report.
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause

exit /b %exit_code%
