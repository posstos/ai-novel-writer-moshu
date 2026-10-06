import type { ModelProfile } from '../../src/shared/ipc-channels'
import type { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions } from './provider.interface'
import { OpenAIProvider } from './openai-provider'

interface ManagedLease { profile: ModelProfile; release: () => void }
export type AcquireManagedLease = (model: ModelProfile, signal?: AbortSignal) => Promise<ManagedLease>
const acquire: AcquireManagedLease = async (model, signal) => {
  const { getManagedLocalManager } = await import('../services/managed-local')
  return getManagedLocalManager().acquire(model, signal)
}

/** Re-resolve the private endpoint after every restart; never fall back to a cloud provider. */
export class ManagedLocalProvider implements ILLMProvider {
  constructor(private readonly lease: AcquireManagedLease = acquire, private readonly inner: ILLMProvider = new OpenAIProvider()) {}
  async generate(model: ModelProfile, messages: Array<{ role: string; content: string }>, options: LLMGenerateOptions): Promise<LLMResponse> {
    let lease: ManagedLease | undefined
    try {
      lease = await this.lease(model)
      return await this.inner.generate(lease.profile, messages, options)
    } catch (error) {
      return { success: false, content: '', finishReason: 'error', error: 'Local engine / 本地引擎: ' + String(error) }
    } finally { lease?.release() }
  }
  async generateStream(model: ModelProfile, messages: Array<{ role: string; content: string }>, options: LLMStreamOptions): Promise<void> {
    let lease: ManagedLease | undefined
    try {
      options.signal.throwIfAborted()
      lease = await this.lease(model, options.signal)
      options.signal.throwIfAborted()
      await this.inner.generateStream(lease.profile, messages, options)
    } catch (error) { options.onError('Local engine / 本地引擎: ' + String(error)) }
    finally { lease?.release() }
  }
}
