#Requires -Version 5.1
param([switch]$Yes, [switch]$ReplaceClaudeMd, [switch]$NoImpeccable, [switch]$NoGitHook,
    [switch]$SkipPrerequisiteCheck, [switch]$CiMode)

$ProgressPreference = 'SilentlyContinue'
$NodeMajorFloor = 22
$NodeFix = 'winget install --id OpenJS.NodeJS.LTS --exact --scope user, then re-run'

function Get-NodeMajorVersion {
    if ((Get-Command node -ErrorAction SilentlyContinue) -and ((& node --version 2>$null | Select-Object -First 1) -match '^v?(\d+)\.')) { return [int]$Matches[1] }
    return 0
}

if ((Get-NodeMajorVersion) -lt $NodeMajorFloor -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "[oso-code] the installer itself runs on Node.js $NodeMajorFloor or newer - installing it per-user with winget"
    & winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements --silent --scope user
    $registryPath = @('Machine', 'User') | ForEach-Object { [Environment]::GetEnvironmentVariable('Path', $_) } | Where-Object { $_ }
    $env:Path = ((@($registryPath -split ';') + ($env:Path -split ';')) | Where-Object { $_ } | Select-Object -Unique) -join ';'
}
if ((Get-NodeMajorVersion) -lt $NodeMajorFloor -and -not $SkipPrerequisiteCheck) {
    Write-Error "[oso-code] Node.js $NodeMajorFloor or newer is required and this run could not provide it - $NodeFix. If Node IS installed and only this check cannot see it, re-run with -SkipPrerequisiteCheck"
    exit 1
}

$gitRoots = @(Get-Command git -ErrorAction SilentlyContinue |
    ForEach-Object { Split-Path -Parent (Split-Path -Parent $_.Source) }) +
    (Join-Path $env:ProgramFiles 'Git') + (Join-Path $env:LOCALAPPDATA 'Programs\Git')
$gitRoots | ForEach-Object { Join-Path $_ 'bin\bash.exe' } | Where-Object { Test-Path $_ } |
    Select-Object -First 1 | ForEach-Object { $env:CLAUDE_CODE_GIT_BASH_PATH = $_ }

$switchedOn = [ordered]@{ '--yes' = $Yes; '--replace-claude-md' = $ReplaceClaudeMd
    '--no-impeccable' = $NoImpeccable; '--no-git-hook' = $NoGitHook }
$argv = @('install', '--host', 'claude') + @($switchedOn.Keys | Where-Object { $switchedOn[$_] })

if ($CiMode) {
    Write-Host "[oso-code] CI mode: delegation forwards [$($argv -join ' | ')] - skipping the authenticated install"
    exit 0
}
& node (Join-Path $PSScriptRoot 'oso.js') @argv
exit $LASTEXITCODE
