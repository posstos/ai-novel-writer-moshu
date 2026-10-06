import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { ModelProfile } from '../../../src/shared/ipc-channels'
import { parseManagedDownloadSource, validateManagedSpec, type ManagedLocalSpec, type ManagedSnapshot, type ManagedDevice } from '../../../src/shared/managed-local'
import { ManagedModelRegistry } from './registry'
import { allocateLoopbackPort, isolatedEngineEnvironment, spawnOwnedEngine, stopOwnedEngine } from './process'

interface EngineManifest {
  schemaVersion: number
  ollamaVersion: string
  llamaCppVersion: string
  entries: Array<{ path: string; sha256: string; bytes: number }>
}
export interface ManagedRuntimePaths { home: string; engines: string; downloadFiles: string[] }
export interface ManagedRuntimeDependencies {
  fetch: typeof fetch
  spawn: typeof spawnOwnedEngine
  stop: typeof stopOwnedEngine
  port: typeof allocateLoopbackPort
  verify?: (relative: string) => Promise<string>
}
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))
const modelAlias = (id: string) => 'moshu-' + id.replaceAll('-', '')
const keyOf = (spec: ManagedLocalSpec) => JSON.stringify(spec)

export class ManagedLocalManager {
  readonly registry: ManagedModelRegistry
  private readonly deps: ManagedRuntimeDependencies
  private child: ChildProcess | null = null
  private stopFlight: Promise<void> | null = null
  private pending: { key: string; controller: AbortController; promise: Promise<void> } | null = null
  private current: ManagedLocalSpec | null = null
  private readyKey = ''
  private endpoint = ''
  private apiKey = ''
  private tail = ''
  private status: ManagedSnapshot['status'] = 'stopped'
  private phase = 'idle'
  private error: string | null = null
  private requests = 0
  private cpuFallback = false
  constructor(readonly paths: ManagedRuntimePaths, dependencies: Partial<ManagedRuntimeDependencies> = {}) {
    this.registry = new ManagedModelRegistry(paths.home)
    this.deps = { fetch: globalThis.fetch, spawn: spawnOwnedEngine, stop: stopOwnedEngine, port: allocateLoopbackPort, ...dependencies }
  }
  private manifest(): EngineManifest {
    const file = path.join(this.paths.engines, 'manifest.json')
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Invalid embedded runtime manifest')
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as EngineManifest
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries) || typeof data.ollamaVersion !== 'string' || typeof data.llamaCppVersion !== 'string') throw new Error('Invalid embedded runtime manifest')
    return data
  }
  downloadSource() {
    const file = this.paths.downloadFiles.find(candidate => fs.existsSync(candidate))
    if (!file) return parseManagedDownloadSource(null)
    if (fs.statSync(file).size > 16 * 1024) throw new Error('Model download configuration is too large')
    return parseManagedDownloadSource(JSON.parse(fs.readFileSync(file, 'utf8')))
  }
  snapshot(): ManagedSnapshot {
    let manifest: EngineManifest | undefined
    try { manifest = this.manifest() } catch { /* Availability is reported without starting or installing anything. */ }
    let download = parseManagedDownloadSource(null)
    let downloadError: string | null = null
    try { download = this.downloadSource() } catch (error) { downloadError = String(error) }
    return {
      status: this.status, phase: this.phase, error: this.error || downloadError,
      activeEngine: this.current?.engine ?? null, activeModelId: this.current?.modelId ?? null,
      activeRequests: this.requests, cpuFallback: this.cpuFallback,
      engines: [
        { id: 'llamacpp', version: manifest?.llamaCppVersion ?? '', available: !!manifest && fs.existsSync(path.join(this.paths.engines, 'llamacpp/cpu/llama-server.exe')) },
        { id: 'ollama', version: manifest?.ollamaVersion ?? '', available: !!manifest && fs.existsSync(path.join(this.paths.engines, 'ollama/ollama.exe')) },
      ],
      models: this.registry.list(), download,
    }
  }
  async verifyExecutable(relative: string): Promise<string> {
    if (this.deps.verify) return this.deps.verify(relative)
    if (!['ollama/ollama.exe', 'llamacpp/cpu/llama-server.exe', 'llamacpp/vulkan/llama-server.exe'].includes(relative)) throw new Error('Unknown runtime entry')
    const entry = this.manifest().entries.find(item => item.path === relative)
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Runtime entry is not integrity-pinned')
    const root = fs.realpathSync.native(this.paths.engines)
    const file = fs.realpathSync.native(path.join(root, relative))
    const inside = path.relative(root, file)
    if (inside.startsWith('..') || path.isAbsolute(inside) || fs.statSync(file).size !== entry.bytes) throw new Error('Runtime entry is missing or outside its bundle')
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    if (hash.digest('hex') !== entry.sha256) throw new Error('Embedded engine checksum mismatch; reinstall a trusted complete package')
    return file
  }
  private alive() { return !!this.child && this.child.exitCode === null && this.child.signalCode === null && !!this.child.pid }
  private async stopChild() {
    if (this.stopFlight) return this.stopFlight
    const child = this.child
    const operation = (async () => {
      if (child) {
        await this.deps.stop(child)
        if (this.child === child) this.child = null
      }
      this.endpoint = ''; this.apiKey = ''
    })()
    this.stopFlight = operation
    try { await operation } finally { if (this.stopFlight === operation) this.stopFlight = null }
  }
  async stop(force = false) {
    if (this.requests > 0 && !force) throw new Error('A generation request is active; cancel it before stopping the engine')
    this.status = 'stopping'; this.phase = 'stopping'
    const pending = this.pending
    pending?.controller.abort(new Error('Engine preparation cancelled'))
    await this.stopChild()
    if (pending) await pending.promise.catch(() => undefined)
    this.current = null; this.readyKey = ''; this.status = 'stopped'; this.phase = 'idle'; this.error = null
  }
  private async response(route: string, init: RequestInit, signal: AbortSignal, timeout = 30000): Promise<Response> {
    signal.throwIfAborted()
    return this.deps.fetch(this.endpoint + route, {
      ...init, redirect: 'error',
      headers: { ...(this.apiKey ? { Authorization: 'Bearer ' + this.apiKey } : {}), ...init.headers },
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    })
  }
  private async json(response: Response): Promise<Record<string, unknown>> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Engine returned an empty response')
    const chunks: Uint8Array[] = []; let bytes = 0
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break
        bytes += next.value.byteLength
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Engine response exceeded the safe limit') }
        chunks.push(next.value)
      }
    } finally { reader.releaseLock() }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    if (!response.ok || data.error) throw new Error(String(data.error || 'Engine HTTP ' + response.status).slice(0, 800))
    return data
  }
  private async waitReady(spec: ManagedLocalSpec, signal: AbortSignal) {
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      if (!this.alive()) throw new Error('Embedded engine exited: ' + this.tail.slice(-1000))
      try {
        const response = await this.response(spec.engine === 'ollama' ? '/api/version' : '/health', {}, signal, 1500)
        if (response.ok) {
          const data = await this.json(response)
          if (spec.engine === 'ollama' && data.version !== this.manifest().ollamaVersion) throw new Error('Unexpected Ollama version on the private port')
          await sleep(80)
          if (!this.alive()) throw new Error('Embedded engine exited while becoming ready')
          return
        }
        await response.body?.cancel()
      } catch (error) {
        if (signal.aborted) throw error
      }
      await sleep(250)
    }
    throw new Error('Engine loading timed out; try CPU mode, a smaller model, or a shorter context')
  }
  private async start(spec: ManagedLocalSpec, device: ManagedDevice, signal: AbortSignal) {
    this.phase = 'verifying-engine'
    const relative = spec.engine === 'ollama' ? 'ollama/ollama.exe' : device === 'cpu' ? 'llamacpp/cpu/llama-server.exe' : 'llamacpp/vulkan/llama-server.exe'
    const executable = await this.verifyExecutable(relative)
    signal.throwIfAborted()
    const port = await this.deps.port()
    signal.throwIfAborted()
    const home = path.join(this.paths.home, 'engine-home', spec.engine)
    const env = isolatedEngineEnvironment(home, executable, device)
    this.endpoint = `http://127.0.0.1:${port}`
    const model = this.registry.get(spec.modelId)
    let args: string[]
    if (spec.engine === 'ollama') {
      env.OLLAMA_HOST = `127.0.0.1:${port}`
      env.OLLAMA_MODELS = path.join(this.paths.home, 'ollama-models')
      env.OLLAMA_CONTEXT_LENGTH = String(spec.contextSize)
      env.OLLAMA_ORIGINS = 'http://127.0.0.1:' + port
      args = ['serve']; this.apiKey = ''
    } else {
      this.apiKey = randomBytes(32).toString('hex')
      const keyFile = path.join(home, 'api-key.txt')
      fs.writeFileSync(keyFile, this.apiKey + '\n', { mode: 0o600 })
      args = ['--model', model.filePath, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', String(spec.contextSize), '--parallel', '1', '--n-gpu-layers', device === 'cpu' ? '0' : 'auto', '--alias', modelAlias(model.id), '--api-key-file', keyFile, '--offline', '--no-webui']
    }
    signal.throwIfAborted()
    this.phase = 'loading-model'; this.tail = ''
    const child = this.deps.spawn(executable, args, env)
    this.child = child
    const append = (chunk: Buffer | string) => {
      let value = String(chunk)
      if (this.apiKey) value = value.replaceAll(this.apiKey, '[redacted]')
      this.tail = (this.tail + value).slice(-8192)
    }
    child.stderr?.on('data', append); child.stdout?.on('data', append)
    child.once('error', error => append(error.message))
    child.once('exit', () => {
      if (this.child === child && this.status === 'ready') {
        this.status = 'error'; this.phase = 'engine-exited'; this.error = 'The application-owned engine stopped; activate the model again'
      }
    })
    await this.waitReady(spec, signal)
    if (spec.engine === 'ollama') await this.prepareOllamaModel(spec, signal)
  }
  private async prepareOllamaModel(spec: ManagedLocalSpec, signal: AbortSignal) {
    this.phase = 'checking-model'
    const model = this.registry.get(spec.modelId)
    const digest = await this.registry.digest(model.id, signal, (bytes, total) => { this.phase = 'hashing-model-' + Math.floor(bytes * 100 / total) })
    const blob = '/api/blobs/sha256:' + digest
    const head = await this.response(blob, { method: 'HEAD' }, signal)
    if (head.status === 404) {
      this.phase = 'importing-model'
      const stream = fs.createReadStream(model.filePath, { signal })
      try {
        const response = await this.response(blob, { method: 'POST', body: stream as unknown as BodyInit, duplex: 'half' } as RequestInit, signal, 900000)
        if (!response.ok) throw new Error('Ollama model import failed (HTTP ' + response.status + ')')
        await response.body?.cancel()
      } finally { stream.destroy() }
    } else if (!head.ok) throw new Error('Ollama blob check failed (HTTP ' + head.status + ')')
    this.registry.get(model.id)
    this.phase = 'preparing-model'
    const response = await this.response('/api/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelAlias(model.id), files: { [path.basename(model.filePath)]: 'sha256:' + digest }, parameters: { num_ctx: spec.contextSize }, stream: false }),
    }, signal, 900000)
    const created = await this.json(response)
    if (created.status !== 'success') throw new Error('Ollama did not confirm model creation')
    this.phase = 'loading-model'
    // Empty prompt loads the explicitly selected model; no prose or remote model pull is requested.
    await this.json(await this.response('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelAlias(model.id), prompt: '', stream: false, keep_alive: '5m', options: { num_ctx: spec.contextSize, num_predict: 0 } }) }, signal, 180000))
  }
  private async prepare(specInput: ManagedLocalSpec) {
    const spec = validateManagedSpec(specInput)
    const selected = this.registry.get(spec.modelId)
    const key = keyOf(spec) + JSON.stringify([selected.filePath, selected.sizeBytes, selected.modifiedMs])
    if (this.current && this.readyKey === key && this.status === 'ready' && this.alive()) return
    if (this.requests > 0) throw new Error('Wait for the active generation to finish before switching models')
    if (this.pending) {
      if (this.pending.key !== key) throw new Error('Another model is loading; stop it before switching')
      return this.pending.promise
    }
    const controller = new AbortController()
    this.status = 'starting'; this.error = null; this.current = spec; this.cpuFallback = false
    const promise = (async () => {
      await this.stopChild()
      const devices: ManagedDevice[] = spec.device === 'auto' ? ['auto', 'cpu'] : ['cpu']
      for (let index = 0; index < devices.length; index++) {
        try {
          controller.signal.throwIfAborted()
          await this.start(spec, devices[index], controller.signal)
          controller.signal.throwIfAborted()
          this.cpuFallback = index > 0
          this.readyKey = key
          this.status = 'ready'; this.phase = 'ready'; this.error = null
          return
        } catch (error) {
          await this.stopChild()
          if (controller.signal.aborted || index === devices.length - 1) throw error
          this.cpuFallback = true; this.phase = 'cpu-fallback'
        }
      }
    })().catch(error => {
      this.status = 'error'; this.phase = 'failed'; this.error = String(error).slice(0, 1200)
      throw error
    }).finally(() => { if (this.pending?.controller === controller) this.pending = null })
    this.pending = { key, controller, promise }
    return promise
  }
  private profile(spec: ManagedLocalSpec, withCredential: boolean): ModelProfile {
    const model = this.registry.get(spec.modelId)
    return {
      id: `managed-${spec.engine}-${model.id}`, name: `${model.name} (${spec.engine === 'ollama' ? 'Ollama' : 'llama.cpp'})`,
      provider: spec.engine === 'ollama' ? 'ollama' : 'custom', protocol: 'openai',
      baseUrl: this.endpoint + '/v1', modelName: modelAlias(model.id), apiKey: withCredential ? this.apiKey : '',
      temperature: 0.7, maxTokens: Math.min(2048, Math.floor(spec.contextSize / 2)),
      purposes: ['generation', 'refinement', 'summary'],
      capabilities: { contextWindowTokens: spec.contextSize, maxOutputTokens: Math.min(2048, Math.floor(spec.contextSize / 2)), reasoning: false, structuredOutput: false, usage: false },
      managedLocal: spec,
    }
  }
  async importSelectedFile(filePath: string) {
    if (this.pending || this.requests > 0) throw new Error('Stop model activity before importing another file')
    if (this.child) await this.stop()
    return this.registry.importSelectedFile(filePath)
  }
  async activate(spec: ManagedLocalSpec): Promise<ModelProfile> {
    const valid = validateManagedSpec(spec)
    await this.prepare(valid)
    return this.profile(valid, false)
  }
  async acquire(model: ModelProfile, signal?: AbortSignal) {
    if (!model.managedLocal || model.protocol !== 'openai' || !['custom', 'ollama'].includes(model.provider) || model.purposes.includes('embedding')) throw new Error('Invalid managed generation profile')
    signal?.throwIfAborted()
    const spec = validateManagedSpec(model.managedLocal)
    const preparation = this.prepare(spec)
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason ?? new Error('Request cancelled')) }
        signal.addEventListener('abort', aborted, { once: true })
        preparation.then(() => { signal.removeEventListener('abort', aborted); resolve() }, error => { signal.removeEventListener('abort', aborted); reject(error) })
        if (signal.aborted) aborted()
      })
    } else await preparation
    signal?.throwIfAborted()
    this.requests += 1
    let released = false
    return {
      profile: { ...model, ...this.profile(spec, true), id: model.id, name: model.name, maxTokens: model.maxTokens, temperature: model.temperature, apiKey: this.apiKey, managedLocal: spec },
      release: () => { if (!released) { released = true; this.requests = Math.max(0, this.requests - 1) } },
    }
  }
  async forget(id: string) {
    if (this.pending || this.requests > 0) throw new Error('Stop model activity before removing an import')
    if (this.current?.modelId === id) await this.stop()
    this.registry.forget(id)
  }
}
