#Requires -Version 5.1
<#
oso-code Windows bootstrap. Provisions the prerequisites Windows lacks out of the
box, then delegates to the cross-platform bootstrap/install.sh under Git Bash so
the installer logic lives in exactly one place (no PowerShell port).

Provisioning (per-user via winget when a tool is missing): Git for Windows
(brings Git Bash), jq, Node.js LTS (context7 starts via npx). Claude Code is
installed via its official Windows installer when the `claude` command is absent,
because install.sh requires it on PATH before it will run.

Nothing here elevates on its own. Every winget install asks for the per-user
scope, and the machine-wide retry that raises a UAC prompt runs only where the
operator answered yes to that prompt being raised - never under -Yes, which
answers install.sh's own confirmation and is no consent to elevate.

Provisioning is best effort; the requirements are not. Once provisioning is done
the run either has what install.sh needs or stops HERE, naming every gap and the
command that closes it - rather than spending the whole winget and vendor-install
time to die inside a bash script on the same gap.

CI-safe mode (-CiMode) boundary: a GitHub windows-latest runner has no
authenticated Claude Code and must not mutate ~/.claude. So -CiMode probes and
provisions prerequisites, locates Git Bash, runs `bash -n` on install.sh, and
then delegates through Invoke-Installer itself against a stub that records the
argv it is handed - then stops. It never installs Claude Code and never runs the
real install.sh (which needs an authenticated `claude` and rewrites the home
dir), and `claude` is the one requirement it does not enforce, for that same
reason. It exercises every PowerShell-specific path without the authenticated
tail.

Usage: install.ps1 [-Yes] [-ReplaceClaudeMd] [-NoImpeccable] [-NoGitHook]
                   [-SkipPrerequisiteCheck] [-CiMode]
  -Yes              forward --yes to install.sh (skip its confirmation prompt)
  -ReplaceClaudeMd  forward --replace-claude-md (replace ~/.claude/CLAUDE.md)
  -NoImpeccable     forward --no-impeccable (skip installing the impeccable plugin)
  -NoGitHook        forward --no-git-hook (skip wiring this repo's commit gate)
  -SkipPrerequisiteCheck
                    install anyway when the checks cannot see a tool that really
                    is there (an unusual PATH, a portable install). At your own
                    risk: install.sh re-checks git, jq and claude itself, so a
                    gap that is real stops the run there instead, after the
                    provisioning time this one already spent.
  -CiMode           provision + delegation smoke test only (see boundary above)
#>
param(
    [switch]$Yes,
    [switch]$ReplaceClaudeMd,
    [switch]$NoImpeccable,
    [switch]$NoGitHook,
    [switch]$SkipPrerequisiteCheck,
    [switch]$CiMode
)

# Suppress winget/download progress bars so CI logs stay readable.
$ProgressPreference = 'SilentlyContinue'

$ClaudeInstallerUrl = 'https://claude.ai/install.ps1'
$WingetSetupUrl = 'https://aka.ms/getwinget'
$GitDownloadUrl = 'https://git-scm.com/download/win'
$ClaudeDownloadUrl = 'https://code.claude.com'

# Where the official Windows installer puts the binary. Probed as a path and not
# only as a command - see Resolve-ClaudeCommand for what that fallback is for.
$ClaudeNativeExe = Join-Path $env:USERPROFILE '.local\bin\claude.exe'

# Node is a hard requirement here, and at a VERSION rather than merely present:
# the fallow package this bootstrap provisions declares `engines: node >=22`, so
# a machine on 18 or 20 clears a presence-only probe and then fails an install
# this script could still have refused. context7 starts through npx from the same
# install.
$NodeMajorFloor = 22

# winget returns HRESULTs as its process exit code and PowerShell surfaces a
# native exit code as a signed Int32, so 0x8A150010 arrives here as this negative
# (both spellings are columns of the same row in winget's documented return
# codes). APPINSTALLER_CLI_ERROR_NO_APPLICABLE_INSTALLER is what winget answers
# when no installer in the manifest matches the scope that was asked for, and it
# is the only answer that makes a machine-wide retry meaningful: a download
# failure, a refused source agreement or a full disk each come back as some other
# code, and retrying those without --scope would turn a network blip into a UAC
# prompt nobody asked for.
$WingetNoApplicableInstaller = -1978335216

function Write-Info { param([string]$Message) Write-Host "[oso-code] $Message" }
function Write-Warn { param([string]$Message) Write-Warning "[oso-code] $Message" }

function Stop-WithError {
    param([string]$Message)
    Write-Error "[oso-code] $Message"
    exit 1
}

function Test-CommandExists {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

# Winget writes new tools into the registry PATH, but the current process keeps
# its stale copy until a new shell starts. Re-read Machine+User PATH so a freshly
# installed tool becomes visible without asking the operator to reopen anything.
# The refresh is a UNION, never a replacement: an entry that lives only in this
# process - an nvm/fnm/volta shim, a caller's prepend, a CI-injected path, a
# portable Git - is in no registry scope, and dropping it takes Find-GitBash's own
# `git` with it. Ordering is the behavior: the registry scopes come FIRST, because
# appending them behind a stale process PATH would re-shadow the very tool this
# refresh exists to expose.
function Update-EnvPath {
    $registry = @('Machine', 'User') |
        ForEach-Object { [Environment]::GetEnvironmentVariable('Path', $_) } |
        Where-Object { $_ } |
        ForEach-Object { $_ -split ';' }
    $processOnly = @($env:Path -split ';' | Where-Object { $registry -notcontains $_ })
    $env:Path = (@($registry) + $processOnly | Where-Object { $_ } | Select-Object -Unique) -join ';'
}

function Invoke-Bootstrap {
    Write-Info 'Windows bootstrap starting'
    $hasWinget = Test-WingetAvailable
    Install-Prerequisites -HasWinget $hasWinget
    if (-not $CiMode) {
        Install-ClaudeCode
    }

    $bash = Find-GitBash
    Assert-Prerequisites -BashExe $bash

    if ($CiMode) {
        Invoke-DelegationSmokeTest -BashExe $bash
    }
    else {
        Invoke-Installer -BashExe $bash
        exit $LASTEXITCODE
    }
}

function Test-WingetAvailable {
    if (Test-CommandExists 'winget') {
        return $true
    }
    Write-Warn "winget not found - install App Installer from $WingetSetupUrl, or install Git for Windows, Node.js LTS, and jq manually, then re-run."
    return $false
}

function Install-Prerequisites {
    param([bool]$HasWinget)
    Install-Prerequisite -WingetId 'Git.Git' -Command 'git' -HasWinget $HasWinget
    Install-Prerequisite -WingetId 'jqlang.jq' -Command 'jq' -HasWinget $HasWinget
    Install-Prerequisite -WingetId 'OpenJS.NodeJS.LTS' -Command 'node' -HasWinget $HasWinget
}

function Install-Prerequisite {
    param(
        [string]$WingetId,
        [string]$Command,
        [bool]$HasWinget
    )
    if (Test-CommandExists $Command) {
        Write-Info "$Command already present"
        return
    }
    if (-not $HasWinget) {
        Write-Warn "$Command missing and winget unavailable - install $WingetId manually, then re-run"
        return
    }

    Write-Info "installing $WingetId via winget"
    Install-WingetPackage -WingetId $WingetId
    Update-EnvPath
    if (Test-CommandExists $Command) {
        Write-Info "$Command installed"
    }
    else {
        Write-Warn "$Command installed but not on PATH yet - reopen the terminal and re-run"
    }
}

# Per-user first, and machine-wide only where somebody said yes to it: the whole
# promise of the one-step Windows path is that it needs no administrator, and a
# machine-wide winget install is exactly where that stops being true. The retry
# used to fire on ANY non-zero exit and never looked at its own result, so a
# download failure, a refused source agreement or a full disk all came back
# around as an elevation prompt - and a second failure was reported as success.
function Install-WingetPackage {
    param([string]$WingetId)
    $common = @(
        'install', '--id', $WingetId, '--exact',
        '--accept-package-agreements', '--accept-source-agreements', '--silent'
    )
    $manual = "winget install --id $WingetId --exact"
    & winget @common '--scope' 'user'
    if ($LASTEXITCODE -eq 0) {
        return
    }
    if ($LASTEXITCODE -ne $WingetNoApplicableInstaller) {
        Write-Warn "winget could not install $WingetId per-user (exit $LASTEXITCODE) - fix: $manual --scope user"
        return
    }
    if (-not (Approve-MachineWideInstall -WingetId $WingetId -ManualCommand $manual)) {
        return
    }
    & winget @common
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "the machine-wide install of $WingetId failed (exit $LASTEXITCODE) - fix: $manual"
    }
}

# The consent, and the two shapes of no. -Yes answers install.sh's own
# confirmation prompt and cannot stand in for this one: an unattended run has
# nobody at the keyboard for the UAC dialog either, so it declines and hands the
# command over rather than stalling on a prompt no one will read.
function Approve-MachineWideInstall {
    param(
        [string]$WingetId,
        [string]$ManualCommand
    )
    if ($Yes) {
        Write-Warn "$WingetId ships no per-user installer, and an unattended run never asks Windows for administrator approval - install it yourself, then re-run: $ManualCommand"
        return $false
    }
    Write-Info "$WingetId ships no per-user installer. Installing it machine-wide needs administrator approval (Windows shows a UAC prompt)."
    $answer = Read-Host '[oso-code] install it machine-wide? [y/N]'
    if ($answer -match '^y(es)?$') {
        return $true
    }
    Write-Warn "skipping the machine-wide install of $WingetId - run it yourself when ready: $ManualCommand"
    return $false
}

# Official Windows installer per Anthropic's setup docs: a per-user native install
# needing no admin. Run it in a child process because the vendor script may call
# `exit`, which would otherwise abort this script before it delegates to install.sh.
# The child also forces TLS 1.2 so the download works on stock PowerShell 5.1.
function Install-ClaudeCode {
    if (Resolve-ClaudeCommand) {
        Write-Info 'claude already present'
        return
    }
    Write-Info 'installing Claude Code (official Windows installer)'
    $childCommand = @(
        '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12'
        "Invoke-RestMethod -Uri '$ClaudeInstallerUrl' | Invoke-Expression"
    ) -join '; '
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $childCommand

    # Whether that worked is not decided here. Assert-Prerequisites re-reads every
    # requirement at once, so a vendor install that produced nothing is reported
    # beside whatever else is missing instead of as a warning that scrolls away.
    Update-EnvPath
}

# `claude` right after its own installer ran is the one probe seen to answer no on
# a machine where the install SUCCEEDED, which is why the line this replaces only
# warned: the vendor installer writes the registry PATH that Update-EnvPath
# re-reads, and a delayed write or a roaming profile can still leave this process
# seeing none of it. So a missing command is not yet a missing install - the
# binary's documented home is checked too, and prepending its directory is the
# point of checking rather than a side effect: install.sh runs as a child and
# resolves `claude` off the environment it inherits, so a probe that answered
# "installed, somewhere" would pass here and fail there.
function Resolve-ClaudeCommand {
    if (Test-CommandExists 'claude') {
        return $true
    }
    if (-not (Test-Path $ClaudeNativeExe)) {
        return $false
    }
    $env:Path = (Split-Path -Parent $ClaudeNativeExe) + ';' + $env:Path
    Write-Info "claude found at $ClaudeNativeExe - added to PATH for this run"
    return $true
}

# Git Bash sits under Git's install root. Derive it from git.exe first, then fall
# back to the machine- and user-scope default locations.
function Find-GitBash {
    $candidates = @()
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $gitRoot = Split-Path -Parent (Split-Path -Parent $git.Source)
        $candidates += (Join-Path $gitRoot 'bin\bash.exe')
    }
    $candidates += (Join-Path $env:ProgramFiles 'Git\bin\bash.exe')
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    return $null
}

# Provisioning above is best effort by design: a machine that already carries a
# tool winget cannot install is a machine that installs fine, so a probe that
# comes back empty there is news, not a verdict. This is where it becomes one.
# install.sh checks git, jq and claude itself and aborts on any of them, so a gap
# carried past this line buys the operator the entire winget and vendor-install
# wait for the same refusal, delivered by a bash script, with the actionable half
# of the message already scrolled off a double-clicked console.
function Assert-Prerequisites {
    param([string]$BashExe)
    $unmet = @(Get-UnmetPrerequisites -BashExe $BashExe)
    if ($unmet.Count -eq 0) {
        Write-Info 'prerequisites complete'
        return
    }
    # The escape hatch waives the probes, never Git Bash: with nothing to delegate
    # TO, continuing only moves the same abort somewhere less legible.
    if ($SkipPrerequisiteCheck -and $BashExe) {
        Write-Warn "-SkipPrerequisiteCheck: continuing past $($unmet.Count) unmet prerequisite(s), at your own risk. install.sh checks git, jq and claude itself and will stop there if they are really missing:"
        foreach ($problem in $unmet) {
            Write-Warn "  $problem"
        }
        return
    }
    $report = @("cannot install - $($unmet.Count) prerequisite(s) missing:")
    $report += $unmet
    $report += 'Close what is named above and re-run. If one of these IS installed and only this check cannot see it, re-run with -SkipPrerequisiteCheck.'
    Stop-WithError ($report -join [Environment]::NewLine)
}

# What install.sh cannot run without, each paired with the command that closes it,
# and read AFTER provisioning so what it names is what this run could not fix.
# All of them at once rather than the first: a machine missing two tools should
# learn that in one read, not one re-run at a time.
function Get-UnmetPrerequisites {
    param([string]$BashExe)
    $unmet = @()
    if (-not $BashExe) {
        $unmet += "Git Bash - install Git for Windows ($GitDownloadUrl), or: winget install --id Git.Git --exact --scope user"
    }
    if (-not (Test-CommandExists 'git')) {
        $unmet += 'git is not on PATH - winget install --id Git.Git --exact --scope user'
    }
    if (-not (Test-CommandExists 'jq')) {
        $unmet += 'jq is not on PATH - winget install --id jqlang.jq --exact --scope user'
    }
    $nodeMajor = Get-NodeMajorVersion
    if ($nodeMajor -lt $NodeMajorFloor) {
        $found = 'none on PATH'
        if ($nodeMajor -gt 0) { $found = "found v$nodeMajor" }
        $unmet += "Node.js $NodeMajorFloor or newer ($found) - winget install --id OpenJS.NodeJS.LTS --exact --scope user"
    }
    # CI never installs Claude Code (see the boundary at the top) and so can never
    # satisfy this one; it is the whole reason that mode exists.
    if (-not $CiMode -and -not (Resolve-ClaudeCommand)) {
        $unmet += "Claude Code - no claude command on PATH and no $ClaudeNativeExe; install it from $ClaudeDownloadUrl, then re-run"
    }
    return $unmet
}

# The major version, or 0 where node cannot be asked at all - absent, or present
# and not answering. No release ships as 0, so it reads as below every floor
# wherever it lands.
function Get-NodeMajorVersion {
    if (-not (Test-CommandExists 'node')) {
        return 0
    }
    $reported = & node --version 2>$null | Select-Object -First 1
    if ($reported -match '^v?(\d+)\.') {
        return [int]$Matches[1]
    }
    return 0
}

# What CI runs in place of the install, and what it has to catch is a flag that
# quietly stops being forwarded: nothing else on any platform executes
# Invoke-Installer, so a typo in a flag name or a splat that collapses four
# arguments into one string (PowerShell 5.1 has cost this file exactly that bug
# before) would reach an operator before it reached a check. The stub stands in
# for Git Bash and records each argument it is handed as its own line, and the
# comparison below keeps those boundaries rather than joining them away - see
# $argvBoundary for why a joined command line reads the collapsed splat as
# correct. install.sh is never executed, which is what keeps this inside the CI
# boundary.
function Invoke-DelegationSmokeTest {
    param([string]$BashExe)
    $installSh = Get-InstallShPath
    Write-Info "CI mode: syntax-checking install.sh via Git Bash ($BashExe)"
    & $BashExe '-n' $installSh
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "install.sh failed bash -n syntax check (exit $LASTEXITCODE)"
    }

    $argvLog = Join-Path $env:TEMP 'oso-code-delegation-argv.txt'
    $stubBash = Join-Path $env:TEMP 'oso-code-delegation-bash.cmd'
    Remove-Item $argvLog -Force -ErrorAction SilentlyContinue
    # A .cmd, so the call crosses the same native-command boundary the real Git
    # Bash does. `%~1` hands back each argument with the quoting cmd added stripped
    # back off, so what lands in the log is the argv itself.
    Set-Content -Path $stubBash -Encoding ASCII -Value @(
        '@echo off',
        ':record',
        'if "%~1"=="" goto :eof',
        ">>`"$argvLog`" echo %~1",
        'shift',
        'goto record'
    )

    Invoke-Installer -BashExe $stubBash
    $recorded = @()
    if (Test-Path $argvLog) {
        $recorded = @(Get-Content $argvLog)
    }
    Remove-Item $argvLog, $stubBash -Force -ErrorAction SilentlyContinue

    # The mark that keeps the argument boundaries in the comparison. Joined by a
    # plain space, a splat that collapsed the four flags into one string hands
    # back the very command line four separate arguments produce, so the bug this
    # smoke test exists for compares equal and ships green; only a mark an
    # argument cannot hold tells the two apart. Windows forbids a pipe in a path
    # and no forwarded flag carries one, so none of this argv can forge it.
    $argvBoundary = ' | '
    $recordedArgv = $recorded -join $argvBoundary
    $expectedArgv = (@($installSh) + @(Get-ForwardedFlags)) -join $argvBoundary
    if ($recordedArgv -ne $expectedArgv) {
        Stop-WithError "CI mode: delegation handed [$recordedArgv] to Git Bash, expected [$expectedArgv]"
    }
    Write-Info "CI mode: delegation forwards [$expectedArgv] - skipping the authenticated install"
    exit 0
}

# The exit code rides $LASTEXITCODE to the caller rather than a return value, and
# the delegated run's own output rides this function's output stream: capturing
# either would take install.sh's live output off the operator's screen and into a
# variable.
function Invoke-Installer {
    param([string]$BashExe)
    $installSh = Get-InstallShPath
    $forwarded = @(Get-ForwardedFlags)

    # Git Bash takes $HOME from an inherited $HOME first, then HOMEDRIVE+HOMEPATH,
    # and only then %USERPROFILE%; claude.exe is a Node process, so os.homedir() -
    # %USERPROFILE%, always - is the only tree it ever opens. A roaming or
    # HOMESHARE corporate profile, or a machine carrying an MSYS2 $HOME of its own,
    # splits the two, and then install.sh writes CLAUDE.md, settings.json and every
    # backup where the client never looks while verify.sh reads that same wrong
    # tree and reports green. The child inherits this process environment, so one
    # assignment settles it. Forward slashes for the reason Get-InstallShPath
    # hands them over.
    $env:HOME = $env:USERPROFILE -replace '\\', '/'

    # The Git Bash this run found, handed to install.sh to publish as
    # env.CLAUDE_CODE_GIT_BASH_PATH in settings.json - what Claude Code spawns
    # every one of this plugin's .sh hooks through when it cannot locate Git Bash
    # by itself. Discovered HERE (Find-GitBash already had to answer it) and
    # WRITTEN there, never from PowerShell: 5.1's ConvertFrom-Json |
    # ConvertTo-Json defaults to -Depth 2 and flattens everything deeper, and
    # settings.json holds nested hook arrays - a whole-file rewrite from this side
    # would make the least-tested half of this bootstrap silently destructive.
    # It travels as the child's environment, the same one-assignment idiom
    # $env:HOME above uses, rather than as a flag: Get-ForwardedFlags below is the
    # argv the CI delegation smoke test compares element for element, and a value
    # that differs on every machine has no place in that comparison.
    $env:CLAUDE_CODE_GIT_BASH_PATH = $BashExe

    Write-Info "delegating to install.sh under Git Bash ($BashExe)"
    & $BashExe $installSh @forwarded
}

# The one table that says which switch means which flag. install.sh makes an
# unknown flag a hard exit, so a spelling that drifts here does not degrade - it
# stops the install at its own argument parser, or silently drops the opt-out the
# operator asked for.
function Get-ForwardedFlags {
    $forwarded = @()
    if ($Yes) { $forwarded += '--yes' }
    if ($ReplaceClaudeMd) { $forwarded += '--replace-claude-md' }
    if ($NoImpeccable) { $forwarded += '--no-impeccable' }
    if ($NoGitHook) { $forwarded += '--no-git-hook' }
    return $forwarded
}

# Git Bash reads backslash paths as escapes, so hand it the forward-slash form.
function Get-InstallShPath {
    return (Join-Path $PSScriptRoot 'install.sh') -replace '\\', '/'
}

Invoke-Bootstrap
