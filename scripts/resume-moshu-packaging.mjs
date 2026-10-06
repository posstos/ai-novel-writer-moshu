/* Recover only interrupted archive work after a verified directory/NSIS build. No rebuilds or model work. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { executeLogged } from './lib/moshu-process.mjs'

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const suffix = process.argv.find(arg => arg.startsWith('--release-suffix='))?.slice('--release-suffix='.length)
if (!suffix || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(suffix)) throw new Error('A valid unique release suffix is required')
const OUT = path.join(ROOT, 'release', `moshu-${VERSION}-win-x64-${suffix}`)
const reportFile = path.join(OUT, 'BUILD-REPORT.json')
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
const build = JSON.parse(fs.readFileSync(path.join(ROOT, '.runtime/moshu-package/build-summary.json'), 'utf8'))
if (report.status !== 'running' || report.version !== VERSION || build.status !== 'passed' || build.version !== VERSION) throw new Error('This helper only resumes a matching interrupted successful build')
for (const name of ['package-structure', 'node-require', 'hidden-ui-smoke', 'portable-copy-checks']) {
  if (!report.steps.some(step => step.name === name && step.status === 'passed')) throw new Error('Directory qualification has not passed: ' + name)
}
const portableName = `Moshu-Portable-${VERSION}-win-x64.zip`
const installerName = `Moshu-Setup-${VERSION}-win-x64.exe`
const sourceName = `Moshu-Source-${VERSION}.zip`
const portableFolder = `Moshu-${VERSION}-win-x64`
const installer = path.join(OUT, installerName)
if (!fs.existsSync(installer) || !fs.existsSync(path.join(OUT, portableFolder, 'Moshu.exe'))) throw new Error('Missing previously built installer or portable directory')
if (fs.existsSync(path.join(OUT, sourceName))) throw new Error('A source archive already exists; inspect rather than overwrite it')
// Read-only liveness check; never terminate another command-owner scope.
const ps = `$p=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','7za.exe','makensis.exe') -and ($_.CommandLine -like '*scripts/package-moshu.mjs*' -or $_.CommandLine -like '*${portableName}*' -or $_.CommandLine -like '*${sourceName}*') }); @{count=$p.Count} | ConvertTo-Json -Compress`
const scan = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
if (scan.status !== 0 || JSON.parse(scan.stdout.replace(/^\uFEFF/, '')).count !== 0) throw new Error('A related packaging process may still be running; refusing concurrent archive writes')
const lock = path.join(OUT, '.archive-recovery.lock')
const descriptor = fs.openSync(lock, 'wx', 0o600)
fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); fs.closeSync(descriptor)
const recovery = fs.mkdtempSync(path.join(ROOT, '.runtime/moshu-package/recovery-'))
const logs = path.join(recovery, 'logs'); fs.mkdirSync(logs)
const seven = fs.readFileSync(path.join(ROOT, '.runtime/moshu-package/7za-path.txt'), 'utf8').trim()
const hash = async file => { const digest = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest('hex') }
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
fs.copyFileSync(reportFile, path.join(recovery, 'BUILD-REPORT.before-recovery.json'))
report.archiveRecovery = { startedAt: new Date().toISOString(), scope: 'portable-and-source-archives-only', installerRebuilt: false, relatedProcessesAtStart: 0, evidence: path.relative(ROOT, recovery) }
save()
try {
  const installerBefore = await hash(installer)
  const incomplete = path.join(OUT, portableName)
  if (fs.existsSync(incomplete)) {
    const test = spawnSync(seven, ['t', incomplete], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
    fs.writeFileSync(path.join(logs, 'interrupted-archive-test.log'), String(test.stdout || '') + String(test.stderr || '') + '\nEXIT_CODE=' + test.status + '\n')
    if (test.status === 0) throw new Error('Existing ZIP passed integrity; refusing to replace it without a separate contents review')
    report.archiveRecovery.interruptedZipBytes = fs.statSync(incomplete).size
    report.archiveRecovery.interruptedZipTestExit = test.status
    fs.renameSync(incomplete, path.join(recovery, portableName + '.interrupted'))
  }
  const newPortable = path.join(recovery, portableName)
  console.log('RECOVER portable ZIP (existing installer is unchanged)')
  executeLogged(seven, ['a', '-tzip', '-mx=3', '-mmt=4', newPortable, portableFolder], { cwd: OUT, log: path.join(logs, 'portable-compress.log'), timeout: 1800000 })
  executeLogged(seven, ['t', newPortable], { cwd: OUT, log: path.join(logs, 'portable-integrity.log'), timeout: 300000 })
  fs.renameSync(newPortable, path.join(OUT, portableName))
  report.steps.push({ name: 'recovered-portable-zip', status: 'passed', compression: 'ZIP Deflate level 3, 4 threads', integrityChecked: true }); save()
  const sourceRoot = path.join(recovery, 'source-payload')
  const sourceStage = path.join(sourceRoot, `AI-Novel-Writer-moshu-${VERSION}-source`)
  fs.mkdirSync(sourceStage, { recursive: true })
  for (const file of ['.eslintrc.cjs', '.gitattributes', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'electron-builder.json5', 'electron-builder.moshu.cjs', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'vitest.browser.config.ts', 'vitest.local-model.config.ts', 'vitest.moshu.config.ts', 'vitest.managed-local.config.ts', 'vitest.settings-browser.config.ts', 'vitest.shims.d.ts', 'index.html', 'LICENSE', 'README.md', 'README_zh.md', 'README_en.md']) fs.copyFileSync(path.join(ROOT, file), path.join(sourceStage, file))
  for (const dir of ['src', 'electron', 'scripts', 'test', 'public', 'packaging', 'docs']) fs.cpSync(path.join(ROOT, dir), path.join(sourceStage, dir), { recursive: true })
  fs.mkdirSync(path.join(sourceStage, 'build')); fs.copyFileSync(path.join(ROOT, 'build/moshu.ico'), path.join(sourceStage, 'build/moshu.ico'))
  fs.rmSync(path.join(sourceStage, 'scripts/browser-fixtures/node_modules'), { recursive: true, force: true })
  const newSource = path.join(recovery, sourceName)
  executeLogged(seven, ['a', '-tzip', '-mx=5', '-mmt=4', newSource, '.'], { cwd: sourceRoot, log: path.join(logs, 'source-compress.log'), timeout: 300000 })
  executeLogged(seven, ['t', newSource], { cwd: ROOT, log: path.join(logs, 'source-integrity.log'), timeout: 120000 })
  fs.renameSync(newSource, path.join(OUT, sourceName))
  fs.rmSync(sourceRoot, { recursive: true, force: true })
  if (await hash(installer) !== installerBefore) throw new Error('Existing installer changed during recovery')
  const artifacts = []
  for (const file of [installerName, portableName, sourceName]) artifacts.push({ file, bytes: fs.statSync(path.join(OUT, file)).size, sha256: await hash(path.join(OUT, file)) })
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n')
  report.artifacts = artifacts
  report.steps.push({ name: 'recovered-source-zip', status: 'passed', integrityChecked: true, installerUnchanged: true })
  report.archiveRecovery.finishedAt = new Date().toISOString(); report.status = 'passed'; report.finishedAt = new Date().toISOString(); save()
  console.log(JSON.stringify({ status: report.status, artifacts }))
} catch (error) {
  report.status = 'failed'; report.archiveRecovery.error = String(error); save(); throw error
} finally { fs.unlinkSync(lock) }
