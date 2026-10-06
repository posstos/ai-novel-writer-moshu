import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagedModelRegistry, inspectGguf } from '../managed-local/registry'
import { ManagedLocalManager } from '../managed-local/manager'
import { isolatedEngineEnvironment } from '../managed-local/process'
import type { ManagedLocalSpec } from '../../../src/shared/managed-local'

const roots: string[] = []
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-managed-unit-')); roots.push(dir); return dir }
function fakeGguf(root: string, name = '中文 模型.gguf') {
  const file = path.join(root, name), header = Buffer.alloc(128)
  header.write('GGUF'); header.writeUInt32LE(3, 4); header.writeBigUInt64LE(1n, 8); header.writeBigUInt64LE(1n, 16)
  fs.writeFileSync(file, header); return file
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('GGUF import registry, without real model weights', () => {
  it('records a selected Unicode path without copying or deleting the source', () => {
    const root = temp(), file = fakeGguf(root), registry = new ManagedModelRegistry(path.join(root, 'private'))
    const model = registry.importSelectedFile(file)
    expect(model.filePath).toBe(fs.realpathSync.native(file)); expect(model.sizeBytes).toBe(128)
    expect(registry.list()).toHaveLength(1); registry.forget(model.id)
    expect(registry.list()).toHaveLength(0); expect(fs.existsSync(file)).toBe(true)
  })
  it('deduplicates a repeated selected path', () => {
    const root = temp(), file = fakeGguf(root), registry = new ManagedModelRegistry(path.join(root, 'private'))
    expect(registry.importSelectedFile(file).id).toBe(registry.importSelectedFile(file).id)
    expect(registry.list()).toHaveLength(1)
  })
  it('does not treat extensions as evidence of valid GGUF', () => {
    const root = temp(), file = path.join(root, 'not-a-model.gguf'); fs.writeFileSync(file, Buffer.alloc(128))
    expect(() => inspectGguf(file)).toThrow(/GGUF/)
  })
  it('rejects archives, incomplete headers and split model imports', () => {
    const root = temp()
    expect(() => inspectGguf(fakeGguf(root, 'model.zip'))).toThrow(/gguf/)
    const short = path.join(root, 'short.gguf'); fs.writeFileSync(short, 'GGUF')
    expect(() => inspectGguf(short)).toThrow()
    expect(() => inspectGguf(fakeGguf(root, 'model-00001-of-00003.gguf'))).toThrow(/Split/)
  })
  it('fails closed on corrupt registry data without overwriting it', () => {
    const root = temp(), file = fakeGguf(root), home = path.join(root, 'private'); fs.mkdirSync(home)
    const registryFile = path.join(home, 'models.json'); fs.writeFileSync(registryFile, '{ broken')
    expect(() => new ManagedModelRegistry(home).importSelectedFile(file)).toThrow(/corrupt/)
    expect(fs.readFileSync(registryFile, 'utf8')).toBe('{ broken')
  })
  it('detects changed or missing model files before launch', () => {
    const root = temp(), file = fakeGguf(root), registry = new ManagedModelRegistry(path.join(root, 'private'))
    const model = registry.importSelectedFile(file); fs.appendFileSync(file, 'changed')
    expect(() => registry.get(model.id)).toThrow(/changed/)
    fs.unlinkSync(file); expect(() => registry.get(model.id)).toThrow()
  })
  it('hashes as a stream and reuses the digest only for an unchanged file', async () => {
    const root = temp(), file = fakeGguf(root), registry = new ManagedModelRegistry(path.join(root, 'private'))
    const model = registry.importSelectedFile(file), progress = vi.fn(), signal = new AbortController().signal
    const digest = await registry.digest(model.id, signal, progress)
    expect(digest).toBe(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))
    expect(progress).toHaveBeenCalled(); progress.mockClear()
    expect(await registry.digest(model.id, signal, progress)).toBe(digest); expect(progress).not.toHaveBeenCalled()
  })
})

describe('private engine environment', () => {
  it('does not inherit cloud credentials, proxy settings, old model directories or Node options', () => {
    const root = temp()
    const env = isolatedEngineEnvironment(path.join(root, 'home'), path.join(root, 'engine.exe'), 'cpu', {
      SystemRoot: process.env.SystemRoot || 'C:\\Windows', OLLAMA_MODELS: 'old-private-models', OLLAMA_HOST: '0.0.0.0:11434',
      HF_TOKEN: 'secret', HTTP_PROXY: 'proxy', NODE_OPTIONS: '--require attacker', PATH: 'untrusted',
    })
    expect(env.HF_TOKEN).toBeUndefined(); expect(env.HTTP_PROXY).toBeUndefined(); expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.OLLAMA_MODELS).toBeUndefined(); expect(env.OLLAMA_HOST).toBeUndefined()
    expect(env.PATH).not.toContain('untrusted'); expect(env.OLLAMA_NO_CLOUD).toBe('1')
    expect(env.CUDA_VISIBLE_DEVICES).toBe('-1'); expect(env.OLLAMA_VULKAN).toBe('0')
    expect(env.USERPROFILE).toBe(path.join(root, 'home'))
  })
})

function harness(failVulkan = false) {
  const root = temp(), engines = path.join(root, 'engines'), home = path.join(root, 'profile')
  fs.mkdirSync(engines); fs.writeFileSync(path.join(engines, 'manifest.json'), JSON.stringify({ schemaVersion: 1, ollamaVersion: '0.34.4', llamaCppVersion: 'b11146', entries: [] }))
  const source = path.join(root, 'model-download.json'); fs.writeFileSync(source, JSON.stringify({ url: '', extractionCode: '' }))
  const processes: ChildProcess[] = []
  const spawn = vi.fn((file: string, _args: string[], _env: NodeJS.ProcessEnv) => {
    const child = Object.assign(new EventEmitter(), { pid: 100000 + processes.length, exitCode: failVulkan && file.includes('vulkan') ? 1 : null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess
    processes.push(child); return child
  })
  const stop = vi.fn(async (child: ChildProcess) => { Object.assign(child, { exitCode: 0 }); child.emit('exit', 0, null) })
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/version') return Response.json({ version: '0.34.4' })
    if (url.pathname === '/health') return Response.json({ status: 'ok' })
    if (url.pathname.startsWith('/api/blobs/')) return new Response(null, { status: init?.method === 'HEAD' ? 404 : 201 })
    if (url.pathname === '/api/create') return Response.json({ status: 'success' })
    if (url.pathname === '/api/generate') return Response.json({ done: true, response: '' })
    throw new Error('Unexpected URL: ' + String(input))
  })
  const manager = new ManagedLocalManager({ home, engines, downloadFiles: [source] }, {
    spawn, stop, fetch: fetcher as typeof fetch, port: async () => 45678,
    verify: async relative => path.join(engines, relative),
  })
  const model = manager.registry.importSelectedFile(fakeGguf(root))
  const spec: ManagedLocalSpec = { engine: 'llamacpp', modelId: model.id, device: 'auto', contextSize: 4096 }
  return { root, manager, model, spec, processes, spawn, stop, fetcher, source }
}

describe('managed lifecycle with simulated engines (no real inference)', () => {
  it('does not start engines or download models when reading status', () => {
    const h = harness(); expect(h.manager.snapshot().status).toBe('stopped')
    expect(h.spawn).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled()
    expect(h.manager.snapshot().download.configured).toBe(false)
  })
  it('uses a private loopback endpoint and token without persisting the token in a model profile', async () => {
    const h = harness(), profile = await h.manager.activate(h.spec)
    const args = h.spawn.mock.calls[0][1]
    expect(args).toContain('127.0.0.1'); expect(args).toContain(h.model.filePath)
    expect(args).toContain('--offline'); expect(args).toContain('--no-webui'); expect(args).toContain('--api-key-file')
    expect(profile.apiKey).toBe(''); expect(profile.managedLocal).toEqual(h.spec)
    const lease = await h.manager.acquire(profile)
    expect(lease.profile.apiKey).toMatch(/^[a-f0-9]{64}$/); expect(lease.profile.baseUrl).toBe('http://127.0.0.1:45678/v1')
    expect(lease.profile.managedLocal).toEqual(h.spec)
    expect(h.manager.snapshot().activeRequests).toBe(1)
    lease.release(); lease.release(); expect(h.manager.snapshot().activeRequests).toBe(0)
    await h.manager.stop(); expect(h.stop).toHaveBeenCalledTimes(1)
  })
  it('reuses a ready model but refuses a switch or stop during active generation', async () => {
    const h = harness(), profile = await h.manager.activate(h.spec), lease = await h.manager.acquire(profile)
    await expect(h.manager.activate({ ...h.spec, contextSize: 8192 })).rejects.toThrow(/active/)
    await expect(h.manager.stop()).rejects.toThrow(/active/)
    expect(h.spawn).toHaveBeenCalledTimes(1); expect(h.stop).not.toHaveBeenCalled()
    lease.release(); await h.manager.stop()
  })
  it('tries the separate CPU runtime if automatic GPU loading fails', async () => {
    const h = harness(true); await h.manager.activate(h.spec)
    expect(h.spawn).toHaveBeenCalledTimes(2)
    expect(h.spawn.mock.calls[1][0]).toContain(path.join('llamacpp', 'cpu'))
    expect(h.manager.snapshot().cpuFallback).toBe(true); expect(h.manager.snapshot().status).toBe('ready')
    await h.manager.stop()
  })
  it('Ollama creates a private blob/model from the selected file and never calls pull', async () => {
    const h = harness(); await h.manager.activate({ ...h.spec, engine: 'ollama', device: 'cpu' })
    const env = h.spawn.mock.calls[0][2]
    expect(env.OLLAMA_HOST).toBe('127.0.0.1:45678'); expect(env.OLLAMA_MODELS).toContain(path.join('profile', 'ollama-models'))
    const urls = h.fetcher.mock.calls.map(call => String(call[0]))
    expect(urls.some(url => url.includes('/api/blobs/sha256:'))).toBe(true)
    expect(urls.some(url => url.endsWith('/api/create'))).toBe(true)
    expect(urls.some(url => /\/api\/pull|https:/.test(url))).toBe(false)
    const create = h.fetcher.mock.calls.find(call => String(call[0]).endsWith('/api/create'))!
    expect(JSON.parse(String(create[1]?.body)).parameters.num_ctx).toBe(4096)
    const warm = h.fetcher.mock.calls.find(call => String(call[0]).endsWith('/api/generate'))!
    expect(JSON.parse(String(warm[1]?.body)).prompt).toBe('')
    await h.manager.stop()
  })
  it('bad publisher download configuration disables that link without hiding local models', () => {
    const h = harness(); fs.writeFileSync(h.source, JSON.stringify({ url: 'https://evil.example/file.exe' }))
    const snapshot = h.manager.snapshot(); expect(snapshot.download.configured).toBe(false)
    expect(snapshot.models).toHaveLength(1); expect(snapshot.error).toContain('pan.quark.cn')
  })
  it('aborted generation never acquires or starts an engine', async () => {
    const h = harness(), controller = new AbortController(); controller.abort()
    await expect(h.manager.acquire({ id: 'm', name: 'm', provider: 'custom', protocol: 'openai', baseUrl: '', modelName: '', apiKey: '', temperature: 0.7, maxTokens: 1024, purposes: ['generation'], managedLocal: h.spec }, controller.signal)).rejects.toThrow()
    expect(h.spawn).not.toHaveBeenCalled()
  })
  it('requires reimport when a user changes the selected model', async () => {
    const h = harness(); fs.appendFileSync(h.model.filePath, 'changed')
    await expect(h.manager.activate(h.spec)).rejects.toThrow(/changed/); expect(h.spawn).not.toHaveBeenCalled()
  })
})
