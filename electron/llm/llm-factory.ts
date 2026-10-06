import { ILLMProvider } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import { OpenAIProvider } from './openai-provider'
import { GeminiProvider } from './gemini-provider'
import { ManagedLocalProvider } from './managed-local-provider'

export class LLMFactory {
  static getProvider(model: ModelProfile): ILLMProvider {
    if (model.managedLocal) return new ManagedLocalProvider()
    if (model.protocol === 'gemini') {
      return new GeminiProvider()
    }
    return new OpenAIProvider()
  }
}
