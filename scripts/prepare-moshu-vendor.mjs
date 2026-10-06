import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { inspectPE } from './lib/moshu-pe.mjs'

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')).replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':')
const VENDOR = path.join(ROOT, '.runtime/moshu-package/vendor')
const URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
const REDIST_SHA256 = 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b'
const RUNTIME_SHA256 = 'd5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066'
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function execute(exe, args, name) {
  const result = spawnSync(exe, args, { cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 })
  fs.writeFileSync(path.join(VENDOR, name + '.log'), String(result.stdout || '') + String(result.stderr || ''))
  if (result.error || result.status !== 0) throw new Error(`${name} failed; inspect the project-local vendor log`)
  return result.stdout
}

function assertMicrosoftSignature(file) {
  const quoted = file.replace(/'/g, "''")
  const code = `$s=Get-AuthenticodeSignature -LiteralPath '${quoted}'; @{Status=[string]$s.Status; Signer=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress`
  const json = execute(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-Command', code], path.basename(file) + '-signature')
  const signature = JSON.parse(json.replace(/^\uFEFF/, ''))
  if (signature.Status !== 'Valid' || !signature.Signer?.includes('O=Microsoft Corporation')) throw new Error('Microsoft Authenticode verification failed')
  return signature
}

function extractCab(file, destination) {
  fs.mkdirSync(destination, { recursive: true })
  execute(path.join(process.env.SystemRoot, 'System32/expand.exe'), ['-F:*', file, destination], path.basename(destination) + '-extract')
}

export function prepareMoshuVendor({ allowDownloads = false } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This preparation must run on Windows x64')
  fs.mkdirSync(VENDOR, { recursive: true })
  const redist = path.join(VENDOR, 'vc_redist.x64.exe')
  if (!fs.existsSync(redist)) {
    if (!allowDownloads) throw new Error('The official VC runtime must be downloaded; explicitly allow project-local build tools first')
    const partial = redist + '.partial'
    execute(path.join(process.env.SystemRoot, 'System32/curl.exe'), ['-fL', '--retry', '2', '--connect-timeout', '30', '--max-time', '240', URL, '-o', partial], 'download')
    if (hash(partial) !== REDIST_SHA256) throw new Error('The official alias now serves different bytes. Re-review its version, signature and checksum; do not silently accept it.')
    fs.renameSync(partial, redist)
  }
  if (hash(redist) !== REDIST_SHA256) throw new Error('Cached Microsoft redistributable checksum mismatch')
  const signature = assertMicrosoftSignature(redist)
  const runtime = path.join(VENDOR, 'vcruntime140.dll')
  const en = path.join(VENDOR, 'Microsoft-VC-Runtime-License-en.rtf')
  const zh = path.join(VENDOR, 'Microsoft-VC-Runtime-License-zh-CN.rtf')
  if (![runtime, en, zh].every(fs.existsSync)) {
    // Read the signed bundle's CAB containers. Never execute the installer, MSI or DLL.
    const data = fs.readFileSync(redist), cabinets = []
    for (let at = data.indexOf('MSCF'); at >= 0; at = data.indexOf('MSCF', at + 4)) {
      if (at + 36 > data.length) continue
      const size = data.readUInt32LE(at + 8)
      if (data[at + 24] !== 3 || data[at + 25] !== 1 || size <= 36 || at + size > data.length) continue
      const cabinet = path.join(VENDOR, `signed-container-${cabinets.length}.cab`)
      fs.writeFileSync(cabinet, data.subarray(at, at + size))
      const folder = path.join(VENDOR, `signed-cab-${cabinets.length}`)
      extractCab(cabinet, folder)
      cabinets.push(folder)
    }
    if (cabinets.length !== 2) throw new Error('Unexpected VC redistributable container layout')
    const manifest = fs.readFileSync(path.join(cabinets[0], '0'), 'utf8')
    const payload = label => {
      const tags = [...manifest.matchAll(/<Payload\b[^>]*>/g)].map(m => m[0])
      const tag = tags.find(t => t.includes(`FilePath="${label}"`))
      const source = tag?.match(/SourcePath="([a-zA-Z0-9]+)"/)?.[1]
      if (!source) throw new Error('Microsoft license payload was not found')
      return path.join(cabinets[0], source)
    }
    fs.copyFileSync(payload('license.rtf'), en)
    fs.copyFileSync(payload('2052\\license.rtf'), zh)
    let selected
    for (const file of fs.readdirSync(cabinets[1])) {
      const input = path.join(cabinets[1], file)
      const bytes = fs.readFileSync(input)
      if (bytes.subarray(0, 4).toString() !== 'MSCF') continue
      const destination = path.join(VENDOR, 'signed-payload-' + file)
      extractCab(input, destination)
      const candidate = path.join(destination, 'vcruntime140.dll_amd64')
      if (fs.existsSync(candidate) && inspectPE(candidate).architecture === 'x64') selected = candidate
    }
    if (!selected) throw new Error('The x64 VC runtime was not found in the signed bundle')
    fs.copyFileSync(selected, runtime)
  }
  if (hash(runtime) !== RUNTIME_SHA256 || inspectPE(runtime).architecture !== 'x64') throw new Error('VC runtime checksum or architecture mismatch')
  const runtimeSignature = assertMicrosoftSignature(runtime)
  const origin = { source: URL, redistSHA256: hash(redist), runtimeSHA256: hash(runtime), version: '14.44.35211.0', redistributableSignature: signature, runtimeSignature, extractionOnly: true, systemInstallationPerformed: false }
  fs.writeFileSync(path.join(VENDOR, 'origin.json'), JSON.stringify(origin, null, 2) + '\n')
  return origin
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(prepareMoshuVendor({ allowDownloads: process.argv.includes('--allow-tool-downloads') }), null, 2))
}
