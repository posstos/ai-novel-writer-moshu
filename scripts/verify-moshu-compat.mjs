/* Qualification of finished, manually distributed Windows packages. Never installs the app. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { executeLogged, isolatedEnvironment } from './lib/moshu-process.mjs'
import { inspectPE } from './lib/moshu-pe.mjs'

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const arg = process.argv.find(value => value.startsWith('--release-suffix='))
const suffix = arg?.slice('--release-suffix='.length)
if (!suffix || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(suffix)) throw new Error('A valid --release-suffix=NAME is required')
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Qualification requires a Windows x64 host')
const RELEASE = path.join(ROOT, 'release', `moshu-${VERSION}-win-x64-${suffix}`)
const LOGS = path.join(ROOT, '.runtime/moshu-validation', suffix)
const resultFile = path.join(RELEASE, 'COMPATIBILITY-REPORT.json')
if (fs.existsSync(resultFile)) throw new Error('Refusing to overwrite an existing compatibility report')
const buildReport = JSON.parse(fs.readFileSync(path.join(RELEASE, 'BUILD-REPORT.json'), 'utf8'))
if (buildReport.status !== 'passed') throw new Error('Packaging must pass before compatibility qualification')
const sevenZip = fs.readFileSync(path.join(ROOT, '.runtime/moshu-package/7za-path.txt'), 'utf8').trim()
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const hashLarge = async file => {
  const digest = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }
fs.mkdirSync(LOGS, { recursive: true })
const report = {
  kind: 'moshu-windows-compatibility', status: 'running', version: VERSION,
  startedAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, osRelease: os.release(), node: process.version },
  steps: [],
  limits: { windows10NotExecuted: Number(os.release().split('.')[2]) >= 22000, windows11NotExecuted: Number(os.release().split('.')[2]) < 22000, secondComputerNotExecuted: true, actualInstallerNotExecuted: true, realModelNotInvoked: true, nonAdminAccountNotSeparatelyTested: true },
}
const save = () => fs.writeFileSync(resultFile, JSON.stringify(report, null, 2) + '\n', 'utf8')
const step = (name, details = {}) => { report.steps.push({ name, status: 'passed', ...details }); save(); console.log(`PASS ${name}`) }
const owner = crypto.randomBytes(24).toString('hex')
const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'moshu-distribution-'))
fs.writeFileSync(path.join(temporaryRoot, '.moshu-validation-owner'), owner)
const unrelatedCwd = path.join(temporaryRoot, '从其他工作目录启动')
fs.mkdirSync(unrelatedCwd)
save()

function archiveCommand(label, args) {
  return executeLogged(sevenZip, args, { cwd: temporaryRoot, log: path.join(LOGS, label + '.log'), timeout: 300_000 })
}
function createProfile(label) {
  const tempParent = path.join(temporaryRoot, '中文临时配置 含空格', label)
  fs.mkdirSync(tempParent, { recursive: true })
  const root = fs.mkdtempSync(path.join(tempParent, 'moshu-package-check-'))
  const token = crypto.randomBytes(24).toString('hex')
  const env = isolatedEnvironment(root, token)
  // The child's os.tmpdir() must agree with the qualification gate's parent check.
  for (const key of Object.keys(env)) {
    if (['temp', 'tmp'].includes(key.toLowerCase())) delete env[key]
  }
  env.TEMP = tempParent
  env.TMP = tempParent
  return { root, token, env }
}
function readMarker(text, prefix) {
  const line = text.split(/\r?\n/).find(value => value.startsWith(prefix))
  if (!line) throw new Error(`Missing ${prefix} evidence`)
  return JSON.parse(line.slice(prefix.length))
}
function nativeCheck(appRoot, label) {
  const { root, env } = createProfile(label + '-native')
  const script = `
    const fs=require('node:fs'), path=require('node:path');
    const req=require('node:module').createRequire(process.argv[1]);
    const assert=require('node:assert/strict');
    (async()=>{
      const folder=path.join(process.argv[2],'数据库 中文');fs.mkdirSync(folder);
      const Database=req('better-sqlite3'), file=path.join(folder,'作品.sqlite');
      let db=new Database(file);db.exec('CREATE TABLE draft (id INTEGER PRIMARY KEY, text TEXT)');
      db.prepare('INSERT INTO draft(text) VALUES (?)').run('中文写入验证');db.close();
      db=new Database(file);assert.equal(db.prepare('SELECT text FROM draft').get().text,'中文写入验证');db.close();
      const lance=req('@lancedb/lancedb');const conn=await lance.connect(path.join(folder,'向量库'));
      const table=await conn.createTable('compatibility',[
        {id:1,vector:[1,0,0,0],text:'中文向量验证'},
        {id:2,vector:[0,1,0,0],text:'第二段测试'}
      ]);
      const rows=await table.vectorSearch([1,0,0,0]).limit(1).toArray();
      assert.equal(Number(rows[0].id),1);assert.equal(rows[0].text,'中文向量验证');
      if(typeof table.close==='function') table.close();
      if(typeof conn.close==='function') conn.close();
      process.stdout.write('MOSHU_NATIVE_COMPAT='+JSON.stringify({sqlitePersistAndReopen:true,lanceCreateAndVectorSearch:true,chineseDataPath:true,electron:process.versions.electron,modules:process.versions.modules})+'\\n');
    })().catch(error=>{console.error(error);process.exitCode=1});`
  const output = executeLogged(path.join(appRoot, 'Moshu.exe'), ['-e', script, path.join(appRoot, 'resources/app.asar/package.json'), root], {
    cwd: unrelatedCwd, env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    log: path.join(LOGS, label + '-native.log'), timeout: 120_000,
  })
  return readMarker(output, 'MOSHU_NATIVE_COMPAT=')
}
// A separate parser keeps the complete JSON object and rejects missing/partial evidence.
function hiddenUiCheck(appRoot, label, scale, safeMode = false) {
  const { root, token, env } = createProfile(label)
  const args = [`--moshu-package-smoke=${token}`, `--user-data-dir=${path.join(root, 'user-data')}`, `--force-device-scale-factor=${scale}`]
  if (safeMode) args.push('--disable-gpu')
  const output = executeLogged(path.join(appRoot, 'Moshu.exe'), args, {
    cwd: unrelatedCwd, env, log: path.join(LOGS, label + '.log'), timeout: 120_000,
  })
  const line = output.split(/\r?\n/).find(value => value.startsWith('{'))
  const evidence = line ? JSON.parse(line) : null
  assert(evidence?.heroReady && evidence.guideReady && evidence.fontsReady && evidence.nodeGlobalsAbsent && evidence.noConfiguredModels && evidence.updatesDisabled && evidence.isolatedProfile && !evidence.windowVisible, `${label}: incomplete hidden-window evidence`)
  return { ...evidence, scaleFactorRequested: scale, safeModeFlags: safeMode, developmentToolsRemovedFromPath: true, unrelatedWorkingDirectory: true, chineseApplicationAndProfilePaths: true }
}
function crc32(buffer) {
  let crc = 0xffffffff
  for (const value of buffer) {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function extractInstallerPayload(installer) {
  // electron-builder stores its application 7z payload uncompressed in NSIS.
  // Validate both 7z header CRCs and archive integrity; never execute the installer.
  const data = fs.readFileSync(installer)
  const signature = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  let attempt = 0
  for (let at = data.indexOf(signature); at >= 0; at = data.indexOf(signature, at + 6)) {
    if (at + 32 > data.length || data[at + 6] !== 0) continue
    if (crc32(data.subarray(at + 12, at + 32)) !== data.readUInt32LE(at + 8)) continue
    const offset = data.readBigUInt64LE(at + 12), size = data.readBigUInt64LE(at + 20)
    const end = BigInt(at + 32) + offset + size
    if (end > BigInt(data.length) || size === 0n) continue
    const nextHeader = data.subarray(Number(BigInt(at + 32) + offset), Number(end))
    if (crc32(nextHeader) !== data.readUInt32LE(at + 28)) continue
    const archive = path.join(temporaryRoot, `installer-payload-${++attempt}.7z`)
    fs.writeFileSync(archive, data.subarray(at, Number(end)))
    const listing = archiveCommand(`installer-list-${attempt}`, ['l', '-slt', archive])
    if (!listing.includes('Moshu.exe') || !/resources[\\/]app\.asar/.test(listing)) continue
    archiveCommand('installer-payload-integrity', ['t', archive])
    const destination = path.join(temporaryRoot, '安装器载荷 中文路径')
    archiveCommand('installer-payload-extract', ['x', '-y', `-o${destination}`, archive])
    assert(fs.existsSync(path.join(destination, 'Moshu.exe')), 'Installer application root not found')
    return { destination, offset: at, bytes: Number(end) - at, sha256: hash(archive) }
  }
  throw new Error('No CRC-validated application 7z payload found in NSIS installer')
}

try {
  for (const artifact of buildReport.artifacts) {
    const file = path.join(RELEASE, artifact.file)
    assert(fs.statSync(file).size === artifact.bytes && await hashLarge(file) === artifact.sha256, `Artifact checksum mismatch: ${artifact.file}`)
  }
  step('artifact-checksums', { artifacts: buildReport.artifacts })
  const portable = path.join(RELEASE, `Moshu-Portable-${VERSION}-win-x64.zip`)
  const source = path.join(RELEASE, `Moshu-Source-${VERSION}.zip`)
  archiveCommand('portable-archive-integrity', ['t', portable])
  archiveCommand('source-archive-integrity', ['t', source])
  const sourceListing = archiveCommand('source-archive-list', ['l', '-slt', source])
  assert(sourceListing.includes('.eslintrc.cjs'), 'Corresponding source omitted the build lint configuration')
  step('zip-integrity', { portable: true, correspondingSource: true, sourceBuildConfigurationIncluded: true })
  const portableParent = path.join(temporaryRoot, '免安装 中文路径 含 空格')
  archiveCommand('portable-extract', ['x', '-y', `-o${portableParent}`, portable])
  const portableRoot = path.join(portableParent, `Moshu-${VERSION}-win-x64`)
  assert(!portableRoot.toLowerCase().startsWith(ROOT.toLowerCase() + path.sep), 'Relocation must be outside the source checkout')
  const rootRequire = createRequire(path.join(ROOT, 'package.json'))
  const asar = createRequire(rootRequire.resolve('electron-builder'))('@electron/asar')
  const main = asar.extractFile(path.join(portableRoot, 'resources/app.asar'), 'dist-electron/main.js').toString('utf8')
  assert(main.includes('disableHardwareAcceleration') && !main.includes('disable-gpu-sandbox'), 'Bundled Windows graphics policy is not the safe compatibility policy')
  const modules = path.join(portableRoot, 'resources/app.asar.unpacked/node_modules')
  const binaries = [
    path.join(portableRoot, 'Moshu.exe'), path.join(portableRoot, 'vcruntime140.dll'),
    path.join(modules, 'better-sqlite3/build/Release/better_sqlite3.node'),
    path.join(modules, '@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node'),
  ]
  const pe = binaries.map(file => ({ file: path.relative(portableRoot, file), ...inspectPE(file) }))
  assert(pe.every(entry => entry.architecture === 'x64'), 'Non-x64 application/native binary')
  for (const entry of pe) {
    for (const dll of entry.imports.filter(name => /^(vcruntime|msvcp|concrt|vcomp).*\.dll$/i.test(name))) {
      assert(fs.existsSync(path.join(portableRoot, dll)), `Redistributable runtime must be app-local: ${dll}`)
    }
  }
  const origin = JSON.parse(fs.readFileSync(path.join(portableRoot, 'licenses/VC-Runtime-Origin.json'), 'utf8'))
  assert(hash(path.join(portableRoot, 'vcruntime140.dll')) === origin.runtimeSHA256, 'Bundled Microsoft runtime differs from verified origin')
  step('x64-native-and-runtime-layout', { binaries: pe, gpuSandboxDisabled: false, appLocalRuntimeVerified: true })
  step('portable-native-databases', { evidence: nativeCheck(portableRoot, 'portable') })
  step('portable-hidden-ui-100-percent', { evidence: hiddenUiCheck(portableRoot, 'portable-ui', 1) })
  step('portable-safe-mode-200-percent', { evidence: hiddenUiCheck(portableRoot, 'portable-safe-ui', 2, true) })
  const installer = path.join(RELEASE, `Moshu-Setup-${VERSION}-win-x64.exe`)
  const payload = extractInstallerPayload(installer)
  const compare = ['Moshu.exe', 'resources/app.asar', 'vcruntime140.dll', 'Moshu-Safe-Mode.cmd', 'resources/security/windows-safe-file-system.ps1']
  for (const file of compare) assert(hash(path.join(payload.destination, file)) === hash(path.join(portableRoot, file)), `Installer and portable differ: ${file}`)
  step('installer-payload-equivalence', { launcherArchitecture: inspectPE(installer).architecture, payloadArchitecture: 'x64', embeddedArchive: { offset: payload.offset, bytes: payload.bytes, sha256: payload.sha256 }, identicalFiles: compare, installerExecuted: false })
  step('installer-payload-native-databases', { evidence: nativeCheck(payload.destination, 'installer') })
  step('installer-payload-hidden-ui-150-percent', { evidence: hiddenUiCheck(payload.destination, 'installer-ui', 1.5) })
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  if (fs.readFileSync(path.join(temporaryRoot, '.moshu-validation-owner'), 'utf8') === owner) {
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
      report.ownedTemporaryDirectoryRemoved = true
    } catch (error) {
      report.ownedTemporaryDirectoryRemoved = false
      report.cleanupError = String(error)
      report.status = 'failed'
      process.exitCode = 1
    }
  }
  report.finishedAt = new Date().toISOString()
  save()
}
console.log(JSON.stringify({ status: report.status, steps: report.steps.length, report: path.relative(ROOT, resultFile), error: report.error }))
