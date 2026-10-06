#requires -Version 5.1
# Real native exit-code tests use only an owned fake CMD file, not package managers.
$ErrorActionPreference = 'Stop'
$launcher = Join-Path (Split-Path -Parent $PSScriptRoot) 'start-local-windows.ps1'
. $launcher -LibraryOnly
$script:checks = 0
function Assert-NativeStep {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
    $script:checks++
}
foreach ($text in @('read ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'TypeError: fetch failed', 'UND_ERR_CONNECT_TIMEOUT', 'socket hang up')) {
    Assert-NativeStep (Test-TransientDownloadError $text) 'recognize a transient network failure'
}
foreach ($text in @('ERR_PNPM_OUTDATED_LOCKFILE', 'SELF_SIGNED_CERT_IN_CHAIN', 'Could not find Visual Studio', 'SyntaxError', 'HTTP 404', '')) {
    Assert-NativeStep (-not (Test-TransientDownloadError $text)) 'do not retry deterministic configuration or trust errors'
}
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fixture = Join-Path $repo ('.runtime\native-step-test [&!] ' + [char]0x6D4B + [char]0x8BD5 + '-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
$counter = Join-Path $fixture 'counter.txt'
$fake = Join-Path $fixture 'fake-tool.cmd'
$body = @'
@echo off
setlocal DisableDelayedExpansion
set TRY=0
if exist "%~dp0counter.txt" set /p TRY=<"%~dp0counter.txt"
set /a TRY+=1 >nul
>"%~dp0counter.txt" echo %TRY%
if "%~1"=="always" goto network
if "%~1"=="fatal" goto fatal
if %TRY% LSS 2 goto network
echo recovered
exit /b 0
:network
echo read ECONNRESET 1>&2
exit /b 17
:fatal
echo deterministic setup failure 1>&2
exit /b 23
'@
[IO.File]::WriteAllText($fake, ($body -replace "`r?`n", "`r`n") + "`r`n", $utf8)
try {
    Invoke-NativeStep $fake @('recover') 'Recover a transient fake failure' -MaxAttempts 2
    Assert-NativeStep ([IO.File]::ReadAllText($counter).Trim() -eq '2') 'transient failure retries once and then succeeds'
    [IO.File]::WriteAllText($counter, '0', $utf8)
    $failed = $false
    try { Invoke-NativeStep $fake @('fatal') 'Fake configuration error' -MaxAttempts 3 } catch { $failed = $_.Exception.Message -match 'exit code 23' }
    Assert-NativeStep $failed 'retain the actual non-network failure exit code'
    Assert-NativeStep ([IO.File]::ReadAllText($counter).Trim() -eq '1') 'do not retry deterministic failures'
    [IO.File]::WriteAllText($counter, '0', $utf8)
    $failed = $false
    try { Invoke-NativeStep $fake @('always') 'Repeated fake network error' -MaxAttempts 2 } catch { $failed = $_.Exception.Message -match 'exit code 17' }
    Assert-NativeStep $failed 'exhausted retries preserve the actual failure'
    Assert-NativeStep ([IO.File]::ReadAllText($counter).Trim() -eq '2') 'respect the attempt limit'
    [IO.File]::WriteAllText($counter, '0', $utf8)
    $failed = $false
    try { Invoke-NativeStep $fake @('always') 'Fake app command without retry opt-in' } catch { $failed = $_.Exception.Message -match 'exit code 17' }
    Assert-NativeStep $failed 'default commands propagate failures'
    Assert-NativeStep ([IO.File]::ReadAllText($counter).Trim() -eq '1') 'commands do not retry unless explicitly enabled'
    [IO.File]::WriteAllText($counter, '0', $utf8)
    $failed = $false
    try { Invoke-NativeStep $fake @('always') 'Invalid retry count' -MaxAttempts 4 } catch { $failed = $true }
    Assert-NativeStep $failed 'reject excessive retry counts'
    Assert-NativeStep ([IO.File]::ReadAllText($counter).Trim() -eq '0') 'invalid parameters execute no command'
    Write-Host "PASS: $script:checks native step checks. No downloads or services."
    Write-Output ([pscustomobject]@{ passed = $script:checks; kind = 'native-step' })
} finally {
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
