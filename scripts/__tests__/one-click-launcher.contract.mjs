import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const source = name => readFileSync(fileURLToPath(new URL(name, root)), 'utf8')
const batch = source(encodeURI('一键启动.bat'))
const powershell = source('scripts/start-local-windows.ps1')

test('batch resolves the project relative to itself and preserves special characters', () => {
  assert.match(batch, /setlocal DisableDelayedExpansion/)
  assert.match(batch, /"%~dp0scripts\\start-local-windows\.ps1"/)
  assert.doesNotMatch(batch, /cd\s+[^"\r\n]/i)
})

test('batch retains errors and supplies a non-pausing check-only entry', () => {
  assert.match(batch, /set "launcher_exit=%errorlevel%"/)
  assert.match(batch, /pause >nul/)
  assert.match(batch, /exit \/b %launcher_exit%/)
  assert.match(batch, /if \/i "%~1"=="\/check" goto check/)
  assert.match(batch, /-CheckOnly/)
})

test('PowerShell 5.1 source and batch do not depend on a UTF-8 console code page', () => {
  assert.ok([...batch, ...powershell].every(character => character.charCodeAt(0) < 128))
  assert.match(powershell, /#requires -Version 5\.1/)
})

test('uses the declared exact package manager and the current Node minimum', () => {
  assert.match(powershell, /\$Package\.packageManager/)
  assert.match(powershell, /\[version\]'22\.13\.0'/)
  assert.match(powershell, /Get-PnpmRequirement \$package/)
})

test('manager inspection cannot download or pin a package manager', () => {
  assert.match(powershell, /\$env:COREPACK_ENABLE_NETWORK = '0'/)
  assert.match(powershell, /\$env:COREPACK_ENABLE_AUTO_PIN = '0'/)
  assert.match(powershell, /\$env:npm_config_manage_package_manager_versions = 'false'/)
})

test('manager bootstrap stays in the project cache and is explicitly confirmed', () => {
  assert.match(powershell, /Confirm-Setup "Download pnpm@\$required/)
  assert.match(powershell, /'\.runtime\\launcher'/)
  assert.match(powershell, /'--prefix', \$toolRoot, '--ignore-scripts'/)
  assert.doesNotMatch(powershell, /'--global'|npm install -g|Set-ExecutionPolicy|Invoke-Expression|\biex\b/)
})

test('dependency setup preserves the lockfile and checks for declared changes', () => {
  assert.match(powershell, /Confirm-Setup 'Project dependencies/)
  assert.match(powershell, /'--frozen-lockfile'/)
  assert.match(powershell, /Get-DependencyFingerprint/)
  assert.match(powershell, /Get-FileHash -LiteralPath/)
  assert.doesNotMatch(powershell, /Remove-Item[^\r\n]*(pnpm-lock|node_modules)/)
})

test('check-only returns before any install or service launch', () => {
  const main = powershell.slice(powershell.indexOf('function Invoke-LocalLauncher'))
  const check = main.indexOf('if ($CheckOnly) {')
  const bootstrap = main.indexOf('Confirm-Setup "Download')
  const service = main.indexOf('Start-ExistingOllama $root')
  assert.ok(check > 0 && bootstrap > check && service > bootstrap)
  assert.match(main.slice(check, bootstrap), /return 2/)
})

test('native validation precedes application startup and clears Electron node-only mode', () => {
  assert.ok(powershell.indexOf("@('run', 'rebuild:electron')") < powershell.indexOf("@('run', 'dev')"))
  assert.match(powershell, /Remove-Item Env:ELECTRON_RUN_AS_NODE/)
})

test('does not download models, install Ollama, or kill existing processes', () => {
  assert.match(powershell, /-ArgumentList 'serve'/)
  assert.doesNotMatch(powershell, /ollama\s+pull|ollama\s+run|winget\s+install|Stop-Process|taskkill/i)
  assert.match(powershell, /\$env:OLLAMA_HOST = '127\.0\.0\.1:11434'/)
  assert.match(powershell, /\$request.Proxy = \$null/)
  assert.match(powershell, /if \(Test-LocalPort 11434\)/)
})

test('duplicate launches are guarded and all native failures are propagated', () => {
  assert.match(powershell, /Threading\.Mutex/)
  assert.match(powershell, /WaitOne\(0\)/)
  assert.match(powershell, /AbandonedMutexException/)
  assert.match(powershell, /if \(Test-LocalPort 5180\)/)
  assert.match(powershell, /\$code = \$LASTEXITCODE/)
  assert.match(powershell, /if \(\$code -eq 0\) \{ return \}/)
  assert.match(powershell, /throw "\$Label failed \(exit code \$code\)/)
  assert.match(powershell, /Start-Transcript -LiteralPath/)
})


test('only preparation opts into bounded network retries; app exits are never restarted', () => {
  assert.match(powershell, /\[ValidateRange\(1, 3\)\]\[int\]\$MaxAttempts = 1/)
  assert.match(powershell, /if \(\$networkFailure -and \$attempt -lt \$MaxAttempts\)/)
  assert.match(powershell, /'Install project dependencies' -MaxAttempts 3/)
  const dev = powershell.split('\n').find(line => line.includes("@('run', 'dev')"))
  assert.ok(dev)
  assert.doesNotMatch(dev, /MaxAttempts/)
  assert.doesNotMatch(powershell, /ELECTRON_MIRROR|binary_host_mirror|strict-ssl|NODE_TLS_REJECT_UNAUTHORIZED/)
})

test('UTF-8 output and pinned-tool notices are handled within the launcher process', () => {
  assert.match(powershell, /\[Console\]::OutputEncoding = New-Object Text.UTF8Encoding\(\$false\)/)
  assert.match(powershell, /\[Console\]::OutputEncoding = \$previousOutputEncoding/)
  assert.match(powershell, /\$env:npm_config_update_notifier = 'false'/)
})
