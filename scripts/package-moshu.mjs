/* Moshu manual Windows packaging: electron-builder, isolation checks, portable and source zips. */
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { inspectPE } from './lib/moshu-pe.mjs'
import { executeLogged, isolatedEnvironment } from './lib/moshu-process.mjs'

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')).replace(/^([a-z]):/, (_, drive) => drive.toUpperCase() + ':')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
process.env.ELECTRON_BUILDER_CACHE = path.join(ROOT, '.runtime/moshu-package/builder-cache')
const suffixArgs = process.argv.filter(arg => arg.startsWith('--release-suffix='))
if (suffixArgs.length > 1) throw new Error('Pass --release-suffix only once')
const suffix = suffixArgs[0]?.slice('--release-suffix='.length) ?? ''
if (suffixArgs.length && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(suffix)) {
  throw new Error('Invalid release suffix: use 1-64 letters, digits, hyphens or underscores')
}
const OUT = path.join(ROOT, 'release', `moshu-${VERSION}-win-x64${suffix ? '-' + suffix : ''}`)
// Pass a validated, project-owned output directory to the child builder.
process.env.MOSHU_RELEASE_OUTPUT = OUT
const LOGS = path.join(ROOT, '.runtime/moshu-package/logs', suffix || 'default')
const run = (name, args, options = {}) => executeLogged(process.execPath, args, { cwd: ROOT, log: path.join(LOGS, name + '.log'), timeout: 900_000, ...options })
const sha256 = async file => {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const report = { kind: 'moshu-windows-release', status: 'running', version: VERSION, startedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, osRelease: os.release(), node: process.version }, steps: [], constraints: { systemInstallsPerformed: false, userDataRead: false, realModelCalls: false, installerSilentlyRun: false, existingReleasesOverwritten: false } }
const save = () => fs.writeFileSync(path.join(OUT, 'BUILD-REPORT.json'), JSON.stringify(report, null, 2) + '\n')
const step = (name, detail) => { report.steps.push({ name, status: 'passed', ...detail }); save(); console.log(`STEP ${name} passed`) }
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) {
  throw new Error('Refusing to overwrite an existing release; choose a new --release-suffix=NAME')
}
fs.mkdirSync(OUT, { recursive: true }); save()
process.on('exit', code => {
  if (code !== 0 && report.status !== 'passed') {
    report.status = 'failed'
    report.exitCode = code
    report.finishedAt = new Date().toISOString()
    save()
  }
})
const buildSummary = JSON.parse(fs.readFileSync(path.join(ROOT, '.runtime/moshu-package/build-summary.json'), 'utf8'))
if (buildSummary.status !== 'passed' || buildSummary.version !== VERSION) throw new Error('Run scripts/build-moshu.mjs successfully for this version before packaging')

run('electron-builder-dir', ['node_modules/electron-builder/cli.js', '--win', 'dir', '--x64', '--publish', 'never', '--config', 'electron-builder.moshu.cjs'])
const unpacked = path.join(OUT, 'win-unpacked')
const exe = path.join(unpacked, 'Moshu.exe')
const rootRequire = createRequire(path.join(ROOT, 'package.json'))
const builderRequire = createRequire(rootRequire.resolve('electron-builder'))
const asar = builderRequire('@electron/asar')
const archive = path.join(unpacked, 'resources', 'app.asar')
const unpackedModules = path.join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules')
const sqliteBinding = path.join(unpackedModules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
const lancedbDir = path.join(unpackedModules, '@lancedb', 'lancedb-win32-x64-msvc')
const lancedbBinding = path.join(lancedbDir, 'lancedb.win32-x64-msvc.node')
const bundled = [exe, archive, sqliteBinding, lancedbBinding, path.join(unpacked, 'resources', 'security', 'windows-safe-file-system.ps1'), path.join(unpacked, 'vcruntime140.dll'), path.join(unpacked, 'README-墨墅.md'), path.join(unpacked, 'Moshu-Safe-Mode.cmd'), path.join(unpacked, 'docs', '墨墅使用说明.md'), path.join(unpacked, 'licenses', 'Moshu-GPL-3.0.txt'), path.join(unpacked, 'licenses', 'VC-Runtime-Origin.json')]
for (const file of bundled) if (!fs.existsSync(file)) throw new Error(`Missing packaged file: ${file}`)
const lancedbPE = inspectPE(lancedbBinding)
for (const [file, label] of [[exe, 'launcher'], [sqliteBinding, 'better-sqlite3'], [path.join(unpacked, 'vcruntime140.dll'), 'vcruntime140']]) {
  const pe = inspectPE(file)
  if (pe.architecture !== 'x64') throw new Error(`${label} is not an x64 binary`)
}
if (lancedbPE.architecture !== 'x64') throw new Error('LanceDB binding is not an x64 binary')
const entries = asar.listPackage(archive).map(entry => entry.replace(/\\/g, '/').replace(/^\//, ''))
const requiredInAsar = ['package.json', 'dist/index.html', 'dist/monaco/vs/loader.js', 'dist/monaco/vs/editor/editor.main.js', 'dist/moshu-icon.svg', 'dist/moshu-icon.png', 'dist-electron/main.js', 'dist-electron/preload.mjs']
for (const file of requiredInAsar) if (!entries.includes(file)) throw new Error(`app.asar is missing ${file}`)
for (const pattern of ['src/', 'test/', 'scripts/', 'plugins/']) {
  if (entries.some(entry => entry.startsWith(pattern))) throw new Error(`app.asar leaked development content: ${pattern}`)
}
for (const pattern of ['.env', 'moshu-preview', 'check-moshu-preview', 'vite.moshu-preview', 'pnpm-lock']) {
  if (entries.some(entry => entry.includes(pattern))) throw new Error(`app.asar leaked development content: ${pattern}`)
}
const packagedMetadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
if (packagedMetadata.name !== 'ai-novel-writer' || packagedMetadata.productName !== 'ai-novel-writer' || packagedMetadata.moshuDistribution?.channel !== 'manual') throw new Error('Packaged identity metadata changed unexpectedly')
step('package-structure', { executable: 'Moshu.exe', nativeModules: ['better-sqlite3', 'lancedb-win32-x64-msvc', 'vcruntime140'], asarEntries: entries.length })

function nodeRequireCheck(root, name) {
  const result = spawnSync(path.join(root, 'Moshu.exe'), ['-e', "const s=require('./resources/app.asar/node_modules/better-sqlite3');const d=new s(':memory:');if(d.prepare('select 1 as ok').get().ok!==1)process.exit(2);d.close();const l=require('./resources/app.asar/node_modules/@lancedb/lancedb');process.stdout.write('OK')"], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0 || !String(result.stdout).includes('OK')) throw new Error(`${name} native require check failed: ${String(result.stderr).slice(0, 600)}`)
  return true
}

function hiddenUiCheck(root, label) {
  const token = crypto.randomBytes(24).toString('hex')
  const checkRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'moshu-package-check-'))
  const env = isolatedEnvironment(checkRoot, token)
  const result = spawnSync(path.join(root, 'Moshu.exe'), [`--moshu-package-smoke=${token}`, `--user-data-dir=${path.join(checkRoot, 'user-data')}`], { cwd: path.dirname(exe) === path.dirname(path.join(root, 'Moshu.exe')) ? root : root, env, windowsHide: true, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
  fs.rmSync(checkRoot, { recursive: true, force: true })
  const line = String(result.stdout || '').split(/\r?\n/).find(l => l.startsWith('{'))
  const evidence = line ? JSON.parse(line) : null
  if (result.status !== 0 || !evidence || !evidence.heroReady || !evidence.guideReady || !evidence.updatesDisabled || !evidence.noConfiguredModels || !evidence.quarkShareConfigured || !evidence.quarkShareButtonEnabled || evidence.windowVisible) throw new Error(`${label} hidden UI check failed: exit=${result.status} ${String(result.stdout || result.stderr).slice(0, 600)}`)
  return evidence
}

nodeRequireCheck(unpacked, 'win-unpacked')
step('node-require', {})
step('hidden-ui-smoke', { evidence: hiddenUiCheck(unpacked, 'win-unpacked') })

const portableDir = path.join(OUT, `Moshu-${VERSION}-win-x64`)
fs.rmSync(portableDir, { recursive: true, force: true })
fs.cpSync(unpacked, portableDir, { recursive: true })
nodeRequireCheck(portableDir, 'portable-copy')
step('portable-copy-checks', { evidence: hiddenUiCheck(portableDir, 'portable-copy') })

// Build the expensive installer only after the exact prepackaged application passes.
run('electron-builder-installer', ['node_modules/electron-builder/cli.js', '--win', 'nsis', '--x64', '--prepackaged', unpacked, '--publish', 'never', '--config', 'electron-builder.moshu.cjs'])

const sevenZip = fs.readFileSync(path.join(ROOT, '.runtime/moshu-package/7za-path.txt'), 'utf8').trim()
const portableZip = `Moshu-Portable-${VERSION}-win-x64.zip`
fs.rmSync(path.join(OUT, portableZip), { force: true })
executeLogged(sevenZip, ['a', '-tzip', '-mx=7', portableZip, path.basename(portableDir)], { cwd: OUT, log: path.join(LOGS, 'portable-zip.log'), timeout: 900_000 })

const sourceStage = path.join(OUT, 'source-payload', `AI-Novel-Writer-moshu-${VERSION}-source`)
fs.rmSync(path.join(OUT, 'source-payload'), { recursive: true, force: true })
fs.mkdirSync(sourceStage, { recursive: true })
for (const file of ['.eslintrc.cjs', '.gitattributes', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'electron-builder.json5', 'electron-builder.moshu.cjs', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'vitest.browser.config.ts', 'vitest.local-model.config.ts', 'vitest.moshu.config.ts', 'vitest.managed-local.config.ts', 'vitest.settings-browser.config.ts', 'vitest.shims.d.ts', 'index.html', 'LICENSE', 'README.md', 'README_zh.md', 'README_en.md']) fs.copyFileSync(path.join(ROOT, file), path.join(sourceStage, file))
for (const dir of ['src', 'electron', 'scripts', 'test', 'public', 'packaging', 'docs']) fs.cpSync(path.join(ROOT, dir), path.join(sourceStage, dir), { recursive: true })
fs.mkdirSync(path.join(sourceStage, 'build'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'build/moshu.ico'), path.join(sourceStage, 'build/moshu.ico'))
fs.rmSync(path.join(sourceStage, 'scripts/browser-fixtures/node_modules'), { recursive: true, force: true })
const sourceZip = `Moshu-Source-${VERSION}.zip`
executeLogged(sevenZip, ['a', '-tzip', '-mx=7', sourceZip, '.'], { cwd: path.join(OUT, 'source-payload'), log: path.join(LOGS, 'source-zip.log'), timeout: 900_000 })
fs.renameSync(path.join(OUT, 'source-payload', sourceZip), path.join(OUT, sourceZip))
fs.rmSync(path.join(OUT, 'source-payload'), { recursive: true, force: true })

const installer = path.join(OUT, `Moshu-Setup-${VERSION}-win-x64.exe`)
const artifacts = [
  { file: `Moshu-Setup-${VERSION}-win-x64.exe`, bytes: fs.statSync(installer).size, sha256: await sha256(installer) },
  { file: portableZip, bytes: fs.statSync(path.join(OUT, portableZip)).size, sha256: await sha256(path.join(OUT, portableZip)) },
  { file: sourceZip, bytes: fs.statSync(path.join(OUT, sourceZip)).size, sha256: await sha256(path.join(OUT, sourceZip)) },
]
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), artifacts.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n', 'utf8')
report.artifacts = artifacts
report.status = 'passed'
report.finishedAt = new Date().toISOString()
save()
console.log(JSON.stringify(report))
