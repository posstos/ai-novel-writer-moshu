#requires -Version 5.1
# Standalone regression tests: no Pester, downloads, application, or service startup.
$ErrorActionPreference = 'Stop'
$launcher = Join-Path (Split-Path -Parent $PSScriptRoot) 'start-local-windows.ps1'
$tokens = $null
$errors = $null
[Management.Automation.Language.Parser]::ParseFile($launcher, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { throw ($errors | Out-String) }
. $launcher -LibraryOnly
$script:checks = 0
function Assert-Launcher {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
    $script:checks++
}
Assert-Launcher (Test-NodeVersion 'v22.13.1') 'accept supported Node 22'
Assert-Launcher (Test-NodeVersion 'v24.0.0') 'accept newer Node'
Assert-Launcher (-not (Test-NodeVersion 'v22.12.0')) 'reject older Node 22'
Assert-Launcher (-not (Test-NodeVersion 'v20.20.2')) 'reject Node 20'
Assert-Launcher (-not (Test-NodeVersion 'invalid')) 'reject malformed Node version'
Assert-Launcher ((Get-PnpmRequirement ([pscustomobject]@{ packageManager = 'pnpm@11.11.0' })) -eq '11.11.0') 'read pinned pnpm'
Assert-Launcher ((Get-PnpmRequirement ([pscustomobject]@{ packageManager = 'pnpm@11.11.0+sha512.abcdef' })) -eq '11.11.0') 'accept integrity suffix'
$rejected = $false
try { Get-PnpmRequirement ([pscustomobject]@{ packageManager = 'pnpm@latest; unwanted' }) | Out-Null } catch { $rejected = $true }
Assert-Launcher $rejected 'reject non-exact manager values'
Assert-Launcher (Test-InstallNeeded $false 'new' '') 'missing dependencies require setup'
Assert-Launcher (Test-InstallNeeded $true 'new' 'old') 'changed declarations require setup'
Assert-Launcher (-not (Test-InstallNeeded $true 'same' 'same')) 'unchanged dependencies avoid install'
Assert-Launcher (-not (Test-InstallNeeded $true 'same' '')) 'adopt an already working dependency tree'

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fixture = Join-Path $repo ('.runtime\launcher-test [&!] ' + [char]0x6D4B + [char]0x8BD5 + '-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
$manifestPath = Join-Path $fixture 'package.json'
[IO.File]::WriteAllText($manifestPath, '{"name":"ai-novel-writer","packageManager":"pnpm@11.11.0"}', $utf8)
[IO.File]::WriteAllText((Join-Path $fixture 'pnpm-lock.yaml'), 'lockfileVersion: 9.0', $utf8)
$first = Get-DependencyFingerprint $fixture
[IO.File]::AppendAllText($manifestPath, "`n", $utf8)
Assert-Launcher ((Get-DependencyFingerprint $fixture) -ne $first) 'fingerprint sees declaration changes in special-character paths'

# This harmless fixture is the only native command used by the mocked entrypoint.
$script:fakeNode = Join-Path $fixture 'node-probe.cmd'
[IO.File]::WriteAllText($script:fakeNode, "@echo off`r`necho v22.13.1`r`nexit /b 0`r`n", $utf8)
$script:nodeAvailable = $true
$script:managerAvailable = $false
$script:depsReady = $false
$script:portOccupied = $false
$script:consent = $false
$script:nativeFail = $false
$script:steps = @()
$script:prompts = 0
$script:ollamaStarts = 0
function Find-Executable {
    param([string]$Name)
    if ($Name -eq 'node.exe' -and $script:nodeAvailable) { return $script:fakeNode }
    if ($Name -eq 'npm.cmd') { return $script:fakeNode }
    if ($Name -eq 'pnpm.cmd' -and $script:managerAvailable) { return $script:fakeNode }
    return $null
}
function Get-PnpmVersion { param([string]$Executable) if ($Executable -and $script:managerAvailable) { return '11.11.0' }; return $null }
function Test-ProjectDependencies { param([string]$Node, [string]$Root) return $script:depsReady }
function Test-LocalPort { param([int]$Port) return $script:portOccupied }
function Confirm-Setup { param([string]$Message) $script:prompts++; return $script:consent }
function Start-ExistingOllama { param([string]$Root, [string]$LogDirectory) $script:ollamaStarts++ }
function Invoke-NativeStep {
    param([string]$Executable, [string[]]$Arguments, [string]$Label, [int]$MaxAttempts = 1)
    $script:steps += ,@($Label, $Arguments)
    if ($Label -eq 'Prepare project-local pnpm') { $script:managerAvailable = $true }
    if ($Label -eq 'Install project dependencies') { $script:depsReady = $true }
    if ($script:nativeFail -and $Label -like 'Verify/prepare*') { throw 'Simulated native ABI repair failure' }
}

try {
    $encodingBefore = [Console]::OutputEncoding.CodePage
    $code = Invoke-LocalLauncher -ProjectRoot $fixture -CheckOnly
    Assert-Launcher ($code -eq 2) 'check-only reports incomplete setup'
    Assert-Launcher ([Console]::OutputEncoding.CodePage -eq $encodingBefore) 'check-only leaves console encoding unchanged'
    Assert-Launcher ($script:steps.Count -eq 0 -and $script:prompts -eq 0 -and $script:ollamaStarts -eq 0) 'check-only performs no setup, prompting or service launch'
    Assert-Launcher (-not (Test-Path -LiteralPath (Join-Path $fixture '.runtime'))) 'check-only writes no logs or cache'
    $script:managerAvailable = $true
    $script:depsReady = $true
    Assert-Launcher ((Invoke-LocalLauncher -ProjectRoot $fixture -CheckOnly) -eq 0) 'check-only reports ready dependencies'
    $script:nodeAvailable = $false
    Assert-Launcher ((Invoke-LocalLauncher -ProjectRoot $fixture -CheckOnly) -eq 1) 'missing Node fails before any install'
    Assert-Launcher ($script:steps.Count -eq 0) 'missing Node never bootstraps tools'
    $script:nodeAvailable = $true
    $script:managerAvailable = $false
    $script:depsReady = $false
    Assert-Launcher ((Invoke-LocalLauncher -ProjectRoot $fixture) -eq 2) 'declining setup stops safely'
    Assert-Launcher ($script:steps.Count -eq 0 -and $script:ollamaStarts -eq 0) 'declining does not run commands or services'
    $script:consent = $true
    Assert-Launcher ((Invoke-LocalLauncher -ProjectRoot $fixture) -eq 0) 'confirmed initial setup reaches dev startup'
    Assert-Launcher ($script:steps.Count -eq 4) 'initial setup runs pinned manager, dependencies, native check and dev in order'
    Assert-Launcher ([Console]::OutputEncoding.CodePage -eq $encodingBefore) 'normal startup restores the original console encoding'
    Assert-Launcher ($script:steps[0][1] -contains '--ignore-scripts') 'manager bootstrap suppresses package lifecycle scripts'
    Assert-Launcher ($script:steps[0][1] -notcontains '--global') 'manager bootstrap does not alter global tools'
    Assert-Launcher ($script:steps[1][1] -contains '--frozen-lockfile') 'dependency installation preserves the lockfile'
    Assert-Launcher ($script:steps[3][1][1] -eq 'dev') 'starts development app rather than packaging it'
    Assert-Launcher ($script:ollamaStarts -eq 1) 'Ollama check happens after dependency preparation'
    $script:steps = @()
    $script:prompts = 0
    Assert-Launcher ((Invoke-LocalLauncher -ProjectRoot $fixture -SkipOllama) -eq 0) 'subsequent startup succeeds without bootstrap'
    Assert-Launcher ($script:steps.Count -eq 2 -and $script:prompts -eq 0) 'ready startup requires no installation prompt'
    Assert-Launcher ($script:ollamaStarts -eq 1) 'SkipOllama leaves services untouched'
    $script:steps = @()
    $script:portOccupied = $true
    Assert-Launcher ((Invoke-LocalLauncher -ProjectRoot $fixture) -eq 1) 'occupied app port refuses a duplicate start'
    Assert-Launcher ($script:steps.Count -eq 0) 'occupied port never kills or launches another process'
    $script:portOccupied = $false
    $script:nativeFail = $true
    $script:steps = @()
    Assert-Launcher ((Invoke-LocalLauncher -ProjectRoot $fixture) -eq 1) 'native repair failure is reported'
    Assert-Launcher ($script:steps.Count -eq 1) 'native failure never reaches the app'
    Write-Host "PASS: $script:checks launcher checks. No packages, services or models were installed or started."
    Write-Output ([pscustomobject]@{ passed = $script:checks; kind = 'one-click-launcher' })
} finally {
    # Delete only the unique test fixture, never the launcher's real state or user data.
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
