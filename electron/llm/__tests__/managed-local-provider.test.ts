import { describe, expect, it, vi } from 'vitest'
import { ManagedLocalProvider } from '../managed-local-provider'
import type { ILLMProvider } from '../provider.interface'
import type { ModelProfile } from '../../../src/shared/ipc-channels'
const profile: ModelProfile = { id: 'local', name: 'local', protocol: 'openai', provider: 'custom', apiKey: '', baseUrl: 'http://127.0.0.1:1/v1', modelName: 'managed', temperature: 0.7, maxTokens: 1024, purposes: ['generation'] }
const messages = [{ role: 'user', content: 'Synthetic transport test, not real inference.' }]
const options = { maxTokens: 16, temperature: 0.7 }
describe('managed local provider transport boundary', () => {
  it('resolves fresh endpoints and releases the model lease after a normal response', async () => {
    const release = vi.fn(), resolved = { ...profile, baseUrl: 'http://127.0.0.1:45678/v1' }
    const generate = vi.fn(async () => ({ success: true as const, content: 'fake', finishReason: 'stop' as const }))
    const provider = new ManagedLocalProvider(async () => ({ profile: resolved, release }), { generate, generateStream: vi.fn() } as ILLMProvider)
    expect((await provider.generate(profile, messages, options)).success).toBe(true)
    expect(generate).toHaveBeenCalledWith(resolved, messages, options); expect(release).toHaveBeenCalledTimes(1)
  })
  it('releases the lease on a provider failure', async () => {
    const release = vi.fn()
    const provider = new ManagedLocalProvider(async () => ({ profile, release }), { generate: async () => { throw new Error('test failure') }, generateStream: vi.fn() })
    expect((await provider.generate(profile, messages, options)).success).toBe(false)
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('does not invoke another provider when engine startup fails', async () => {
    const inner = { generate: vi.fn(), generateStream: vi.fn() }
    const provider = new ManagedLocalProvider(async () => { throw new Error('engine missing') }, inner)
    const result = await provider.generate(profile, messages, options)
    expect(result.success).toBe(false); expect(result.finishReason).toBe('error'); expect(inner.generate).not.toHaveBeenCalled()
  })
  it('preserves streaming callbacks and releases the lease', async () => {
    const release = vi.fn(), onDone = vi.fn(), onError = vi.fn(), onChunk = vi.fn()
    const inner: ILLMProvider = { generate: vi.fn(), generateStream: async (_m, _msg, opts) => { opts.onChunk('fake'); opts.onDone('fake', undefined, 'stop') } }
    const provider = new ManagedLocalProvider(async () => ({ profile, release }), inner)
    await provider.generateStream(profile, messages, { ...options, signal: new AbortController().signal, onDone, onError, onChunk })
    expect(onChunk).toHaveBeenCalledWith('fake'); expect(onDone).toHaveBeenCalledWith('fake', undefined, 'stop')
    expect(onError).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1)
  })
  it('an already cancelled stream never starts an engine', async () => {
    const lease = vi.fn(), controller = new AbortController(); controller.abort()
    const provider = new ManagedLocalProvider(lease), error = vi.fn()
    await provider.generateStream(profile, messages, { ...options, signal: controller.signal, onDone: vi.fn(), onError: error, onChunk: vi.fn() })
    expect(lease).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledTimes(1)
  })
})
