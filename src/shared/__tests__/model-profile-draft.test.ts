import { describe, expect, it } from 'vitest'
import { createModelProfileDraft, createLocalModelProfileDraft, changeModelProfileProvider } from '../model-profile-draft'
import { LOW_VRAM_EMBEDDING_OPTIONS } from '../embedding-options'

describe('model profile drafts', () => {
  it('defaults generation to keyless Ollama without inventing an installed model or its capabilities', () => {
    expect(createModelProfileDraft({ id: 'new', purposes: ['generation'] })).toMatchObject({
      id: 'new', provider: 'ollama', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1',
      modelName: '', apiKey: '', maxTokens: 2048,
      capabilities: { contextWindowTokens: null, maxOutputTokens: 2048, reasoning: false, structuredOutput: false, usage: false },
    })
  })

  it('defaults embeddings to a separate local draft with conservative batching', () => {
    expect(createModelProfileDraft({ id: 'embed', purposes: ['embedding'] })).toMatchObject({
      provider: 'ollama', modelName: '', apiKey: '', maxTokens: 0,
      purposes: ['embedding'], embeddingOptions: LOW_VRAM_EMBEDDING_OPTIONS,
      capabilities: { contextWindowTokens: null, maxOutputTokens: 0, structuredOutput: false },
    })
  })

  it('keeps SiliconFlow bge-m3 available by explicit choice', () => {
    expect(createModelProfileDraft({ id: 'cloud', purposes: ['embedding'], provider: 'siliconflow' })).toMatchObject({
      name: 'SiliconFlow BAAI/bge-m3', provider: 'siliconflow', protocol: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1', modelName: 'BAAI/bge-m3', apiKey: '',
      capabilities: { contextWindowTokens: 8192, maxOutputTokens: 0, reasoning: false, structuredOutput: false, usage: true },
    })
  })

  it('can build an LM Studio profile from an explicitly selected installed model', () => {
    expect(createLocalModelProfileDraft({ id: 'lm', purposes: ['generation'], service: 'lmstudio', modelName: 'my-local-model' })).toMatchObject({
      name: 'LM Studio my-local-model', provider: 'custom', baseUrl: 'http://127.0.0.1:1234/v1',
      modelName: 'my-local-model', apiKey: '', maxTokens: 2048,
    })
  })

  it('clears secrets and incompatible capabilities on an explicit provider change without mutating a saved profile', () => {
    const original = Object.freeze({
      ...createModelProfileDraft({ id: 'saved', purposes: ['generation'], provider: 'openai' }),
      apiKey: 'do-not-forward', name: 'Author chosen name', reasoningOverride: 'high' as const,
    })
    const next = changeModelProfileProvider(original, 'ollama')
    expect(next).toMatchObject({ id: 'saved', name: 'Author chosen name', apiKey: '', provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1', modelName: '', reasoningOverride: 'auto', maxTokens: 2048 })
    expect(original.apiKey).toBe('do-not-forward')
    expect(original.provider).toBe('openai')
  })

  it('returns isolated arrays, capabilities and embedding options for each draft', () => {
    const purposes = ['embedding'] as const
    const first = createModelProfileDraft({ id: '1', purposes: [...purposes] })
    const second = createModelProfileDraft({ id: '2', purposes: [...purposes] })
    first.capabilities!.maxOutputTokens = 99
    first.embeddingOptions!.batchSize = 99
    first.purposes.push('generation')
    expect(second.capabilities?.maxOutputTokens).toBe(0)
    expect(second.embeddingOptions?.batchSize).toBe(4)
    expect(second.purposes).toEqual(['embedding'])
  })
})
