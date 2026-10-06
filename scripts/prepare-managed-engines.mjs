/* Build-time acquisition only. No model downloads, installers or global environment changes. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { executeLogged } from './lib/moshu-process.mjs'
import { inspectPE } from './lib/moshu-pe.mjs'
import { prepareMoshuVendor } from './prepare-moshu-vendor.mjs'

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging/embedded-runtime-pins.json'), 'utf8'))
const BASE = path.join(ROOT, '.runtime/managed-engines')
const CACHE = path.join(BASE, 'downloads')
const PAYLOAD = path.join(BASE, 'payload')
const LOGS = path.join(BASE, 'logs')
const allow = process.argv.includes('--allow-runtime-downloads')
const sum = async file => {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build on Windows x64')
for (const folder of [CACHE, PAYLOAD, LOGS]) fs.mkdirSync(folder, { recursive: true })
const reportFile = path.join(BASE, 'PREPARATION-REPORT.json')
const report = { status: 'running', startedAt: new Date().toISOString(), modelsDownloaded: false, systemInstallations: false, archives: [], entries: [], runtimeDlls: [] }
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
save()
async function download(asset) {
  if (!/^[A-Za-z0-9._-]+$/.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid pinned asset')
  const url = new URL(asset.url)
  if (url.protocol !== 'https:' || !['github.com', 'raw.githubusercontent.com'].includes(url.hostname) || url.username || url.password) throw new Error('Untrusted runtime download source')
  const file = path.join(CACHE, asset.name)
  if (fs.existsSync(file)) {
    if (await sum(file) !== asset.sha256) throw new Error('Cached asset checksum mismatch: ' + asset.name)
    return file
  }
  if (!allow) throw new Error('Missing cache; explicitly pass --allow-runtime-downloads: ' + asset.name)
  const partial = file + '.partial'
  console.log('DOWNLOAD ' + asset.name + (asset.bytes ? ` (${asset.bytes} bytes)` : ''))
  await new Promise((resolve, reject) => {
    const curl = path.join(process.env.SystemRoot, 'System32/curl.exe')
    const child = spawn(curl, ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '5', '--retry-all-errors', '--connect-timeout', '25', '--max-time', '3600', '--continue-at', '-', '--output', partial, asset.url], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const log = fs.createWriteStream(path.join(LOGS, asset.name + '-download.log'))
    child.stderr.pipe(log)
    child.once('error', reject)
    child.once('close', code => { log.end(); code === 0 ? resolve() : reject(new Error('Download failed: ' + asset.name + ' exit=' + code)) })
  })
  if ((asset.bytes && fs.statSync(partial).size !== asset.bytes) || await sum(partial) !== asset.sha256) throw new Error('Pinned download integrity check failed: ' + asset.name)
  fs.renameSync(partial, file)
  return file
}
try {
  const seven = fs.readFileSync(path.join(ROOT, '.runtime/moshu-package/7za-path.txt'), 'utf8').trim()
  for (const asset of pins.assets) {
    const archive = await download(asset)
    const destination = path.join(PAYLOAD, asset.directory)
    if (path.relative(PAYLOAD, destination).startsWith('..')) throw new Error('Invalid destination')
    const marker = path.join(destination, '.archive-sha256')
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() !== asset.sha256) throw new Error('Refusing to overwrite a different engine version')
    if (!fs.existsSync(marker)) {
      executeLogged(seven, ['t', archive], { cwd: ROOT, log: path.join(LOGS, asset.name + '-integrity.log'), timeout: 300_000 })
      executeLogged(seven, ['x', '-y', '-o' + destination, archive], { cwd: ROOT, log: path.join(LOGS, asset.name + '-extract.log'), timeout: 300_000 })
      // Some upstream releases contain one enclosing folder; normalize only this owned extraction.
      const expected = path.join(PAYLOAD, asset.entry)
      if (!fs.existsSync(expected)) {
        const find = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => e.isDirectory() ? find(path.join(folder, e.name)) : e.name === path.basename(expected) ? [path.join(folder, e.name)] : [])
        const matches = find(destination)
        if (matches.length !== 1) throw new Error('Cannot locate engine entry: ' + asset.entry)
        const enclosing = path.dirname(matches[0])
        for (const item of fs.readdirSync(enclosing)) fs.renameSync(path.join(enclosing, item), path.join(destination, item))
      }
      fs.writeFileSync(marker, asset.sha256 + '\n')
    }
    const entry = path.join(PAYLOAD, asset.entry)
    if (inspectPE(entry).architecture !== 'x64') throw new Error('Not an x64 engine: ' + asset.entry)
    report.archives.push({ file: asset.name, sha256: asset.sha256, bytes: fs.statSync(archive).size })
    report.entries.push({ path: asset.entry, sha256: await sum(entry), bytes: fs.statSync(entry).size })
    save()
    console.log('VERIFIED ' + asset.entry)
  }
  const licenseDir = path.join(PAYLOAD, 'licenses')
  fs.mkdirSync(licenseDir, { recursive: true })
  for (const license of pins.licenses) fs.copyFileSync(await download(license), path.join(licenseDir, license.name))
  const origin = prepareMoshuVendor({ allowDownloads: false })
  const vendor = path.join(ROOT, '.runtime/moshu-package/vendor')
  const dllNames = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'concrt140.dll', 'vcomp140.dll']
  // Re-extract from the just-verified signed bundle; do not trust older scratch folders.
  const bundle = fs.readFileSync(path.join(vendor, 'vc_redist.x64.exe'))
  const extractRoot = path.join(BASE, 'verified-vc-runtime')
  fs.mkdirSync(extractRoot, { recursive: true })
  const expand = (file, folder, label) => {
    fs.mkdirSync(folder, { recursive: true })
    executeLogged(path.join(process.env.SystemRoot, 'System32/expand.exe'), ['-F:*', file, folder], { cwd: ROOT, log: path.join(LOGS, label + '.log'), timeout: 120_000 })
  }
  const directories = []
  let cabinetIndex = 0
  for (let at = bundle.indexOf('MSCF'); at >= 0; at = bundle.indexOf('MSCF', at + 4)) {
    if (at + 36 > bundle.length || bundle[at + 24] !== 3 || bundle[at + 25] !== 1) continue
    const size = bundle.readUInt32LE(at + 8)
    if (size <= 36 || at + size > bundle.length) continue
    const name = 'container-' + cabinetIndex++
    const outer = path.join(extractRoot, name + '.cab'), folder = path.join(extractRoot, name)
    fs.writeFileSync(outer, bundle.subarray(at, at + size)); expand(outer, folder, name)
    for (const entry of fs.readdirSync(folder)) {
      const input = path.join(folder, entry)
      if (!fs.statSync(input).isFile()) continue
      const data = fs.readFileSync(input)
      if (data.subarray(0, 4).toString() !== 'MSCF' || !data.includes(Buffer.from('vcruntime140.dll_amd64'))) continue
      const destination = path.join(extractRoot, name + '-' + entry)
      expand(input, destination, name + '-' + entry); directories.push(destination)
    }
  }
  if (!directories.length) throw new Error('No x64 runtime cabinet in the verified Microsoft bundle')
  for (const name of dllNames) {
    const candidate = directories.map(d => path.join(d, name + '_amd64')).find(file => fs.existsSync(file) && inspectPE(file).architecture === 'x64')
    if (!candidate) throw new Error('Missing signed x64 VC runtime extraction: ' + name)
    const quoted = candidate.replaceAll("'", "''")
    const ps = `$s=Get-AuthenticodeSignature -LiteralPath '${quoted}'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notlike '*O=Microsoft Corporation*'){exit 1}`
    executeLogged(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-Command', ps], { cwd: ROOT, log: path.join(LOGS, name + '-signature.log'), timeout: 60_000 })
    for (const asset of pins.assets) fs.copyFileSync(candidate, path.join(PAYLOAD, asset.directory, name))
    report.runtimeDlls.push({ file: name, sha256: await sum(candidate), signerVerified: true })
  }
  for (const name of ['Microsoft-VC-Runtime-License-en.rtf', 'Microsoft-VC-Runtime-License-zh-CN.rtf']) fs.copyFileSync(path.join(vendor, name), path.join(licenseDir, name))
  fs.writeFileSync(path.join(licenseDir, 'VC-Runtime-Origin.json'), JSON.stringify({ ...origin, files: report.runtimeDlls }, null, 2) + '\n')
  const manifest = { schemaVersion: 1, platform: 'win32', arch: 'x64', ollamaVersion: pins.ollamaVersion, llamaCppVersion: pins.llamaCppVersion, entries: report.entries, archives: report.archives, modelsIncluded: false }
  fs.writeFileSync(path.join(PAYLOAD, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  fs.copyFileSync(path.join(ROOT, 'packaging/embedded-runtime-pins.json'), path.join(licenseDir, 'runtime-sources.json'))
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString(); save()
}
console.log(JSON.stringify({ status: report.status, report: path.relative(ROOT, reportFile), error: report.error }))
