import { DEFAULT_EMBEDDING_OPTIONS, LOW_VRAM_EMBEDDING_OPTIONS } from './embedding-options'
import type { ModelProfile } from './ipc-channels'
import { createProviderCatalog } from './provider-presets'
import { LOCAL_MODEL_MAX_OUTPUT_TOKENS, LOCAL_MODEL_SERVICES, type LocalModelService } from './local-model-profile'

/** Creates only an unsaved draft; existing profiles and defaults are never migrated. */
export interface CreateModelProfileDraftOptions {
  id: string
  purposes: ModelProfile['purposes']
  provider?: ModelProfile['provider']
}

/** Local-first for generation and embeddings; an explicit provider retains cloud presets. */
export function createModelProfileDraft({
  id,
  purposes,
  provider = 'ollama',
}: CreateModelProfileDraftOptions): ModelProfile {
  const isEmbedding = purposes.includes('embedding')
  const isLocal = provider === 'ollama'
  const preset = createProviderCatalog().find((candidate) => candidate.provider === provider)
  if (!preset) throw new Error(`Missing built-in provider preset: ${provider}`)

  const modelPreset = isEmbedding || isLocal ? undefined : preset.models[0]
  // Catalog examples do not prove that a model is installed on this machine.
  const modelName = isLocal ? '' : isEmbedding
    ? (preset.embeddingModels[0] ?? '')
    : (modelPreset?.name ?? '')
  const capabilities = isLocal
    ? {
        contextWindowTokens: null,
        maxOutputTokens: isEmbedding ? 0 : LOCAL_MODEL_MAX_OUTPUT_TOKENS,
        reasoning: false,
        structuredOutput: false,
        usage: false,
      }
    : isEmbedding ? preset.embeddingModelCapabilities?.[modelName] : modelPreset?.capabilities
  const maxTokens = capabilities?.maxOutputTokens ?? modelPreset?.maxTokens ?? 4096

  return {
    id,
    name: !isLocal && isEmbedding ? `${preset.displayName ?? preset.provider} ${modelName}` : '',
    provider,
    protocol: preset.protocol as ModelProfile['protocol'],
    modelName,
    apiKey: '',
    baseUrl: isLocal ? LOCAL_MODEL_SERVICES.ollama.baseUrl : preset.baseUrl,
    temperature: 0.7,
    maxTokens,
    capabilities: capabilities ? { ...capabilities } : undefined,
    purposes: [...purposes],
    ...(isEmbedding ? { embeddingOptions: { ...(isLocal ? LOW_VRAM_EMBEDDING_OPTIONS : DEFAULT_EMBEDDING_OPTIONS) } } : {}),
  }
}

export function createLocalModelProfileDraft({
  service = 'ollama',
  modelName = '',
  ...options
}: Omit<CreateModelProfileDraftOptions, 'provider'> & {
  service?: LocalModelService
  modelName?: string
}): ModelProfile {
  const endpoint = LOCAL_MODEL_SERVICES[service]
  return {
    ...createModelProfileDraft(options),
    provider: endpoint.provider,
    baseUrl: endpoint.baseUrl,
    modelName,
    name: modelName ? `${endpoint.label} ${modelName}` : '',
  }
}

/** An explicit provider switch must not forward the previous provider's secret. */
export function changeModelProfileProvider(model: ModelProfile, provider: ModelProfile['provider']): ModelProfile {
  return {
    ...model,
    ...createModelProfileDraft({ id: model.id, purposes: model.purposes, provider }),
    name: model.name,
    temperature: model.temperature,
    reasoningOverride: 'auto',
    managedLocal: undefined,
  }
}
