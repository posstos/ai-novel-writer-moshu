#requires -Version 5.1
# ASCII source intentionally supports Windows PowerShell 5.1 without a UTF-8 BOM.
[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$SkipOllama,
    [switch]$LibraryOnly
)

function Test-NodeVersion {
    param([string]$Text)
    if ($Text.Trim() -notmatch '^v?(\d+\.\d+\.\d+)$') { return $false }
    return [version]$Matches[1] -ge [version]'22.13.0'
}

function Get-PnpmRequirement {
    param($Package)
    if ([string]$Package.packageManager -notmatch '^pnpm@(\d+\.\d+\.\d+)(\+sha\d+\.[A-Za-z0-9+/=]+)?$') {
        throw 'package.json must declare an exact pnpm version.'
    }
    return $Matches[1]
}

function Find-Executable {
    param([string]$Name)
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function Get-PnpmVersion {
    param([string]$Executable)
    if (-not $Executable) { return $null }
    # Inspection must not let a Corepack shim or pnpm download another manager.
    $network = $env:COREPACK_ENABLE_NETWORK
    $autoPin = $env:COREPACK_ENABLE_AUTO_PIN
    $manage = $env:npm_config_manage_package_manager_versions
    $preference = $ErrorActionPreference
    Push-Location -LiteralPath ([IO.Path]::GetTempPath())
    try {
        $env:COREPACK_ENABLE_NETWORK = '0'
        $env:COREPACK_ENABLE_AUTO_PIN = '0'
        $env:npm_config_manage_package_manager_versions = 'false'
        $ErrorActionPreference = 'Continue'
        $output = @(& $Executable --version 2>$null)
        if ($LASTEXITCODE -ne 0) { return $null }
        $version = ($output -join "`n").Trim()
        if ($version -match '^\d+\.\d+\.\d+$') { return $version }
        return $null
    } catch { return $null } finally {
        $ErrorActionPreference = $preference
        $env:COREPACK_ENABLE_NETWORK = $network
        $env:COREPACK_ENABLE_AUTO_PIN = $autoPin
        $env:npm_config_manage_package_manager_versions = $manage
        Pop-Location
    }
}

function Get-DependencyFingerprint {
    param([string]$Root)
    $data = foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc')) {
        $path = Join-Path $Root $name
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $name + ':' + (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        } else { $name + ':missing' }
    }
    return ($data -join "`n")
}

function Test-InstallNeeded {
    param([bool]$DependenciesReady, [string]$CurrentFingerprint, [string]$SavedFingerprint)
    return (-not $DependenciesReady) -or ($SavedFingerprint -and $SavedFingerprint -ne $CurrentFingerprint)
}

function Test-ProjectDependencies {
    param([string]$Node, [string]$Root)
    $probe = @'
const fs = require('node:fs');
const path = require('node:path');
try {
  const p = require(path.resolve('package.json'));
  const names = Object.keys({ ...p.dependencies, ...p.devDependencies });
  if (!names.every(name => fs.existsSync(path.join('node_modules', name, 'package.json')))) process.exit(1);
  if (!fs.existsSync(require('electron'))) process.exit(1);
} catch { process.exit(1); }
'@
    Push-Location -LiteralPath $Root
    try {
        & $Node -e $probe 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false } finally { Pop-Location }
}

function Confirm-Setup {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
    Write-Host 'This may download packages. No Ollama installation or model download is performed.'
    $answer = Read-Host 'Continue? [y/N]'
    return $answer.Trim() -match '^(?i:y|yes)$'
}

function Test-TransientDownloadError {
    param([string]$Text)
    return $Text -match '(?i)ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_(CONNECT_TIMEOUT|SOCKET)|fetch failed|socket hang up|network timeout|Client network socket disconnected'
}

function Invoke-NativeStep {
    param([string]$Executable, [string[]]$Arguments, [string]$Label, [ValidateRange(1, 3)][int]$MaxAttempts = 1)
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        Write-Host "`n[STEP] $Label (attempt $attempt/$MaxAttempts)" -ForegroundColor Cyan
        $preference = $ErrorActionPreference
        $networkFailure = $false
        try {
            # Native stderr is output, not a PowerShell exception; use the real exit code.
            $ErrorActionPreference = 'Continue'
            & $Executable @Arguments 2>&1 | ForEach-Object {
                $line = $_.ToString()
                Write-Host $line
                if (Test-TransientDownloadError $line) { $networkFailure = $true }
            }
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $preference }
        if ($code -eq 0) { return }
        if ($networkFailure -and $attempt -lt $MaxAttempts) {
            Write-Host '[WARN] Download connection failed. Retrying in 2 seconds with the same sources and existing cache.' -ForegroundColor Yellow
            Start-Sleep -Seconds 2
            continue
        }
        throw "$Label failed (exit code $code). See the log above; do not delete your novel data."
    }
}

function Test-LocalPort {
    param([int]$Port)
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $pending.Wait(600)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}

function Test-OllamaReady {
    $response = $null
    try {
        $request = [Net.HttpWebRequest]::Create('http://127.0.0.1:11434/api/version')
        $request.Proxy = $null
        $request.Timeout = 1000
        $request.ReadWriteTimeout = 1000
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) { return $false }
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        try {
            $buffer = New-Object char[] 4096
            $length = $reader.ReadBlock($buffer, 0, $buffer.Length)
            if ($length -le 0 -or $length -eq $buffer.Length) { return $false }
            $payload = (-join $buffer[0..($length - 1)]) | ConvertFrom-Json
            return [bool]($payload.version -is [string] -and $payload.version.Trim())
        } finally { $reader.Dispose() }
    } catch { return $false } finally { if ($response) { $response.Close() } }
}

function Start-ExistingOllama {
    param([string]$Root, [string]$LogDirectory)
    if (Test-OllamaReady) { Write-Host '[OK] Ollama is already available.'; return }
    if (Test-LocalPort 11434) { Write-Host '[WARN] Port 11434 is occupied; leaving the existing service unchanged.'; return }
    if ($env:OLLAMA_HOST -and $env:OLLAMA_HOST -notmatch '^(https?://)?(127\.0\.0\.1|localhost):11434/?$') {
        Write-Host '[INFO] Custom OLLAMA_HOST detected; start your configured service manually.'; return
    }
    if (Get-Process -Name 'ollama' -ErrorAction SilentlyContinue) {
        Write-Host '[INFO] An Ollama process already exists. Not starting a duplicate.'; return
    }
    $executable = Find-Executable 'ollama.exe'
    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles)) {
        if ($executable -or -not $base) { continue }
        $relative = if ($base -eq $env:LOCALAPPDATA) { 'Programs\Ollama\ollama.exe' } else { 'Ollama\ollama.exe' }
        $candidate = Join-Path $base $relative
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $executable = $candidate }
    }
    if (-not $executable) {
        Write-Host '[INFO] Ollama was not found. The app can still open; configure a model later.'; return
    }
    $previousHost = $env:OLLAMA_HOST
    try {
        # Bind a newly started service to loopback only; never widen network access.
        $env:OLLAMA_HOST = '127.0.0.1:11434'
        $token = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID
        Start-Process -FilePath $executable -ArgumentList 'serve' -WorkingDirectory $Root -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $LogDirectory "ollama-$token.out.log") `
            -RedirectStandardError (Join-Path $LogDirectory "ollama-$token.err.log") | Out-Null
        for ($attempt = 0; $attempt -lt 5; $attempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-OllamaReady) { Write-Host '[OK] Started the installed Ollama service.'; return }
        }
        Write-Host '[WARN] Ollama did not become ready. Opening the app without claiming model readiness.'
    } catch {
        Write-Host '[WARN] Could not start Ollama. Start it manually if needed; the app will still open.'
    } finally { $env:OLLAMA_HOST = $previousHost }
}

function Invoke-LocalLauncher {
    param([string]$ProjectRoot, [switch]$CheckOnly, [switch]$SkipOllama)
    $ErrorActionPreference = 'Stop'
    $transcribing = $false
    $locked = $false
    $mutex = $null
    $previousOutputEncoding = $null
    Push-Location -LiteralPath $ProjectRoot
    try {
        $root = (Get-Location).ProviderPath
        $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
        if ($package.name -ne 'ai-novel-writer') { throw 'This launcher must be placed in the AI-Novel-Writer project root.' }
        $required = Get-PnpmRequirement $package
        $runtime = Join-Path $root '.runtime\launcher'
        $toolRoot = Join-Path $runtime "tools\pnpm-$required"
        $cachedPnpm = Join-Path $toolRoot 'node_modules\.bin\pnpm.cmd'
        if (-not $CheckOnly) {
            # Node tools emit UTF-8, even in a legacy Chinese Windows console.
            try {
                $previousOutputEncoding = [Console]::OutputEncoding
                [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
            } catch { Write-Host '[WARN] Could not switch this console to UTF-8; ASCII error codes remain readable.' }
            $logDirectory = Join-Path $runtime 'logs'
            [IO.Directory]::CreateDirectory($logDirectory) | Out-Null
            $log = Join-Path $logDirectory ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID + '.log')
            Start-Transcript -LiteralPath $log -Force | Out-Null
            $transcribing = $true
            Write-Host "Log: $log"
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $id = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '') } finally { $sha.Dispose() }
            $mutex = New-Object Threading.Mutex($false, "Local\AI-Novel-Writer-$id")
            try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
            if (-not $locked) { Write-Host '[INFO] A launcher is already running for this project.'; return 0 }
        }
        Write-Host "Project: $root"
        $node = Find-Executable 'node.exe'
        if (-not $node) { throw 'Node.js is missing. Install Node.js 22.13+ (22 LTS recommended), then reopen this launcher.' }
        $nodeVersion = (& $node --version | Out-String).Trim()
        if (-not (Test-NodeVersion $nodeVersion)) { throw "Node.js $nodeVersion is not supported. Node.js 22.13+ is required." }
        Write-Host "[OK] Node.js $nodeVersion"
        $pnpm = $null
        if ((Test-Path -LiteralPath $cachedPnpm) -and (Get-PnpmVersion $cachedPnpm) -eq $required) { $pnpm = $cachedPnpm }
        if (-not $pnpm) {
            $installed = Find-Executable 'pnpm.cmd'
            if (-not $installed) { $installed = Find-Executable 'pnpm.exe' }
            if ((Get-PnpmVersion $installed) -eq $required) { $pnpm = $installed }
        }
        $ready = Test-ProjectDependencies $node $root
        $fingerprint = Get-DependencyFingerprint $root
        $stamp = Join-Path $runtime 'dependencies.txt'
        $saved = if (Test-Path -LiteralPath $stamp) { [IO.File]::ReadAllText($stamp) } else { '' }
        $installNeeded = Test-InstallNeeded $ready $fingerprint $saved
        if ($CheckOnly) {
            Write-Host "Required pnpm: $required; available: $([bool]$pnpm); dependencies ready: $(-not $installNeeded)"
            Write-Host 'CHECK ONLY: no installs, logs, service starts, application launch, or model downloads.'
            if ($pnpm -and -not $installNeeded) { return 0 }
            return 2
        }
        if (Test-LocalPort 5180) { throw 'Port 5180 is already in use. Check the existing app/terminal; no process will be killed automatically.' }
        if (-not $pnpm) {
            if (-not (Confirm-Setup "Download pnpm@$required into this project's launcher cache? Global tools will not be changed.")) { return 2 }
            $npm = Find-Executable 'npm.cmd'
            if (-not $npm) { throw 'npm.cmd was not found. Repair your Node.js installation.' }
            [IO.Directory]::CreateDirectory($toolRoot) | Out-Null
            [IO.File]::WriteAllText((Join-Path $toolRoot 'package.json'), '{"name":"local-launcher-tools","version":"0.0.0","private":true}', (New-Object Text.UTF8Encoding($false)))
            Push-Location -LiteralPath $toolRoot
            try { Invoke-NativeStep $npm @('install', '--prefix', $toolRoot, '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', "pnpm@$required") 'Prepare project-local pnpm' -MaxAttempts 3 } finally { Pop-Location }
            if ((Get-PnpmVersion $cachedPnpm) -ne $required) { throw 'The project-local pnpm installation could not be verified.' }
            $pnpm = $cachedPnpm
        }
        $env:PATH = (Split-Path -Parent $pnpm) + ';' + $env:PATH
        $env:npm_config_manage_package_manager_versions = 'false'
        $env:npm_config_update_notifier = 'false'
        if ($installNeeded) {
            if (-not (Confirm-Setup 'Project dependencies are missing or their declared configuration changed. Install them now?')) { return 2 }
            $installArguments = @('install')
            if (Test-Path -LiteralPath (Join-Path $root 'pnpm-lock.yaml')) { $installArguments += '--frozen-lockfile' }
            Invoke-NativeStep $pnpm $installArguments 'Install project dependencies' -MaxAttempts 3
            if (-not (Test-ProjectDependencies $node $root)) { throw 'Dependencies are still incomplete, including the Electron executable. Read the installation log.' }
        }
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        $env:NODE_ENV = 'development'
        Invoke-NativeStep $pnpm @('run', 'rebuild:electron') 'Verify/prepare Electron SQLite binding (may download or compile native files)' -MaxAttempts 3
        [IO.File]::WriteAllText($stamp, (Get-DependencyFingerprint $root), (New-Object Text.UTF8Encoding($false)))
        if (-not $SkipOllama) { Start-ExistingOllama $root $logDirectory }
        Write-Host 'Opening the Electron desktop app. Keep this window open. Ctrl+C stops development mode.' -ForegroundColor Green
        Invoke-NativeStep $pnpm @('run', 'dev') 'Start AI Novel Writer'
        return 0
    } catch {
        Write-Host ("[ERROR] " + $_.Exception.Message) -ForegroundColor Red
        Write-Host 'Troubleshooting: docs/mcp-one-click-start.md. No system-wide execution policy or global tools were changed.'
        return 1
    } finally {
        if ($locked -and $mutex) { $mutex.ReleaseMutex() }
        if ($mutex) { $mutex.Dispose() }
        if ($transcribing) { Stop-Transcript | Out-Null }
        if ($previousOutputEncoding) {
            try { [Console]::OutputEncoding = $previousOutputEncoding } catch { }
        }
        Pop-Location
    }
}

if (-not $LibraryOnly) {
    exit (Invoke-LocalLauncher -ProjectRoot (Split-Path -Parent $PSScriptRoot) -CheckOnly:$CheckOnly -SkipOllama:$SkipOllama)
}
