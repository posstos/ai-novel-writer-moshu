/* Real executable / empty-server qualification. Deliberately never loads or downloads a model. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'
import { inspectPE } from './lib/moshu-pe.mjs'

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const appArg = process.argv.find(arg => arg.startsWith('--app-dir='))?.slice('--app-dir='.length)
const engineRoot = appArg ? path.resolve(ROOT, appArg, 'resources/engines') : path.join(ROOT, '.runtime/managed-engines/payload')
const label = appArg ? 'packaged' : 'prepared'
const logs = path.join(ROOT, '.runtime/managed-engines/logs', label)
fs.mkdirSync(logs, { recursive: true })
const manifest = JSON.parse(fs.readFileSync(path.join(engineRoot, 'manifest.json'), 'utf8'))
const helper = path.join(logs, 'process-helper.cjs')
buildSync({ entryPoints: [path.join(ROOT, 'electron/services/managed-local/process.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: helper })
const { allocateLoopbackPort, isolatedEngineEnvironment, spawnOwnedEngine, stopOwnedEngine } = createRequire(import.meta.url)(helper)
const temporary = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'moshu-engine-check-'))
const token = crypto.randomBytes(24).toString('hex')
fs.writeFileSync(path.join(temporary, '.owner'), token)
const report = { status: 'running', startedAt: new Date().toISOString(), host: { release: os.release(), arch: process.arch }, modelsDownloaded: false, modelsLoaded: false, inferenceExecuted: false, checks: [] }
let child
let serverLog = ''
async function hash(file) { const h = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex') }
try {
  for (const relative of ['ollama/ollama.exe', 'llamacpp/cpu/llama-server.exe', 'llamacpp/vulkan/llama-server.exe']) {
    const expected = manifest.entries.find(entry => entry.path === relative)
    const file = path.join(engineRoot, relative)
    if (!expected || await hash(file) !== expected.sha256 || inspectPE(file).architecture !== 'x64') throw new Error('Runtime integrity / architecture failed: ' + relative)
  }
  report.checks.push({ name: 'executable-integrity-x64', status: 'passed' })
  for (const variant of ['cpu', 'vulkan']) {
    const executable = path.join(engineRoot, 'llamacpp', variant, 'llama-server.exe')
    const env = isolatedEngineEnvironment(path.join(temporary, '中文 用户', variant), executable, variant === 'cpu' ? 'cpu' : 'auto')
    const result = spawnSync(executable, ['--n-gpu-layers', variant === 'cpu' ? '0' : 'auto', '--offline', '--no-webui', '--version'], { cwd: path.dirname(executable), env, windowsHide: true, encoding: 'utf8', timeout: 30000 })
    fs.writeFileSync(path.join(logs, 'llama-' + variant + '-version.log'), String(result.stdout || '') + String(result.stderr || ''))
    if (result.error || result.status !== 0) throw new Error('llama.cpp ' + variant + ' executable probe failed: exit=' + result.status)
    report.checks.push({ name: 'llama-' + variant + '-version-and-flags', status: 'passed', modelLoaded: false })
  }
  const executable = path.join(engineRoot, 'ollama/ollama.exe')
  const privateHome = path.join(temporary, '中文 用户', 'ollama')
  const env = isolatedEngineEnvironment(privateHome, executable, 'cpu')
  const port = await allocateLoopbackPort()
  env.OLLAMA_HOST = '127.0.0.1:' + port
  env.OLLAMA_MODELS = path.join(temporary, '空模型 缓存')
  env.OLLAMA_CONTEXT_LENGTH = '4096'
  env.OLLAMA_ORIGINS = 'http://127.0.0.1:' + port
  child = spawnOwnedEngine(executable, ['serve'], env)
  child.on('error', error => { serverLog += String(error) })
  const log = data => { serverLog = (serverLog + String(data)).slice(-128 * 1024) }
  child.stdout.on('data', log); child.stderr.on('data', log)
  const deadline = Date.now() + 45000
  let version
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Private Ollama server exited before becoming ready')
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/version', { signal: AbortSignal.timeout(1000), redirect: 'error' })
      if (response.ok) { version = (await response.json()).version; break }
    } catch { /* Bounded startup probe against this owned loopback process. */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (version !== manifest.ollamaVersion) throw new Error('Private Ollama version check failed')
  const response = await fetch('http://127.0.0.1:' + port + '/api/tags', { signal: AbortSignal.timeout(3000), redirect: 'error' })
  const models = await response.json()
  if (!response.ok || !Array.isArray(models.models) || models.models.length !== 0) throw new Error('Ollama qualification did not use the isolated empty model directory')
  report.checks.push({ name: 'private-ollama-server', status: 'passed', version, modelCount: 0, loopbackOnly: true, cloudDisabledInEnvironment: env.OLLAMA_NO_CLOUD === '1', originalServiceUntouched: true })
  await stopOwnedEngine(child)
  report.checks.push({ name: 'owned-process-stop', status: 'passed' })
  child = undefined
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1
} finally {
  if (child) { try { await stopOwnedEngine(child) } catch (error) { report.stopError = String(error); report.status = 'failed'; process.exitCode = 1 } }
  fs.writeFileSync(path.join(logs, 'ollama-empty-server.log'), serverLog)
  try {
    if (fs.readFileSync(path.join(temporary, '.owner'), 'utf8') === token) fs.rmSync(temporary, { recursive: true, force: true })
  } catch (error) { report.cleanupError = String(error); report.status = 'failed'; process.exitCode = 1 }
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(logs, 'NATIVE-ENGINE-REPORT.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report))
