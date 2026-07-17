#Requires -Version 5.1
<#
oso-code Windows bootstrap. Provisions the prerequisites Windows lacks out of the
box, then delegates to the cross-platform bootstrap/install.sh under Git Bash so
the installer logic lives in exactly one place (no PowerShell port).

Provisioning (per-user via winget when a tool is missing): Git for Windows
(brings Git Bash), jq, Node.js LTS (context7 starts via npx). Claude Code is
installed via its official Windows installer when the `claude` command is absent,
because install.sh requires it on PATH before it will run.

CI-safe mode (-CiMode) boundary: a GitHub windows-latest runner has no
authenticated Claude Code and must not mutate ~/.claude. So -CiMode probes and
provisions prerequisites, locates Git Bash, and runs `bash -n` on install.sh as a
delegation smoke test - then stops. It never installs Claude Code and never runs
the real install.sh (which needs an authenticated `claude` and rewrites the home
dir). It exercises every PowerShell-specific path without the authenticated tail.

Usage: install.ps1 [-Yes] [-ReplaceClaudeMd] [-CiMode]
  -Yes              forward --yes to install.sh (skip its confirmation prompt)
  -ReplaceClaudeMd  forward --replace-claude-md (replace ~/.claude/CLAUDE.md)
  -CiMode           provision + delegation smoke test only (see boundary above)
#>
param(
    [switch]$Yes,
    [switch]$ReplaceClaudeMd,
    [switch]$CiMode
)

# Suppress winget/download progress bars so CI logs stay readable.
$ProgressPreference = 'SilentlyContinue'

$ClaudeInstallerUrl = 'https://claude.ai/install.ps1'
$WingetSetupUrl = 'https://aka.ms/getwinget'
$GitDownloadUrl = 'https://git-scm.com/download/win'

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
function Update-EnvPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($machine, $user | Where-Object { $_ }) -join ';'
}

function Invoke-Bootstrap {
    Write-Info 'Windows bootstrap starting'
    $hasWinget = Test-WingetAvailable
    Install-Prerequisites -HasWinget $hasWinget
    if (-not $CiMode) {
        Install-ClaudeCode
    }

    $bash = Find-GitBash
    if (-not $bash) {
        Stop-WithError "Git Bash not found. Install Git for Windows ($GitDownloadUrl), then re-run."
    }

    if ($CiMode) {
        Invoke-DelegationSmokeTest -BashExe $bash
    }
    else {
        Invoke-Installer -BashExe $bash
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

function Install-WingetPackage {
    param([string]$WingetId)
    $common = @(
        'install', '--id', $WingetId, '--exact',
        '--accept-package-agreements', '--accept-source-agreements', '--silent'
    )
    # Prefer a per-user install; retry machine-wide only when the package ships no
    # user-scope installer (winget exits non-zero on the unsupported scope).
    & winget @common '--scope' 'user'
    if ($LASTEXITCODE -ne 0) {
        & winget @common
    }
}

# Official Windows installer per Anthropic's setup docs: a per-user native install
# needing no admin. Run it in a child process because the vendor script may call
# `exit`, which would otherwise abort this script before it delegates to install.sh.
# The child also forces TLS 1.2 so the download works on stock PowerShell 5.1.
function Install-ClaudeCode {
    if (Test-CommandExists 'claude') {
        Write-Info 'claude already present'
        return
    }
    Write-Info 'installing Claude Code (official Windows installer)'
    $childCommand = @(
        '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12'
        "Invoke-RestMethod -Uri '$ClaudeInstallerUrl' | Invoke-Expression"
    ) -join '; '
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $childCommand

    Update-EnvPath
    if (-not (Test-CommandExists 'claude')) {
        Write-Warn 'claude not on PATH yet - reopen the terminal and re-run (install.sh requires it)'
    }
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

function Invoke-DelegationSmokeTest {
    param([string]$BashExe)
    $installSh = Get-InstallShPath
    Write-Info "CI mode: syntax-checking install.sh via Git Bash ($BashExe)"
    & $BashExe '-n' $installSh
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "install.sh failed bash -n syntax check (exit $LASTEXITCODE)"
    }
    Write-Info 'CI mode: prerequisites probed and delegation verified - skipping the authenticated install'
    exit 0
}

function Invoke-Installer {
    param([string]$BashExe)
    $installSh = Get-InstallShPath
    $forwarded = @()
    if ($Yes) { $forwarded += '--yes' }
    if ($ReplaceClaudeMd) { $forwarded += '--replace-claude-md' }

    Write-Info "delegating to install.sh under Git Bash ($BashExe)"
    & $BashExe $installSh @forwarded
    $installExit = $LASTEXITCODE
    exit $installExit
}

# Git Bash reads backslash paths as escapes, so hand it the forward-slash form.
function Get-InstallShPath {
    return (Join-Path $PSScriptRoot 'install.sh') -replace '\\', '/'
}

Invoke-Bootstrap
