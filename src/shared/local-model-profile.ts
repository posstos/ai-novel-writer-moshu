import type { ModelProfile } from './ipc-channels'

export const LOCAL_MODEL_SERVICES = {
  ollama: { label: 'Ollama', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  lmstudio: { label: 'LM Studio', provider: 'custom', baseUrl: 'http://127.0.0.1:1234/v1' },
} as const

export type LocalModelService = keyof typeof LOCAL_MODEL_SERVICES
export const LOCAL_MODEL_MAX_OUTPUT_TOKENS = 2048

type EndpointProfile = Pick<ModelProfile, 'provider' | 'protocol' | 'baseUrl'>

function httpEndpoint(baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

/** Check the parsed host, never a substring such as "localhost" in a remote URL. */
export function isLoopbackModelEndpoint(baseUrl: string): boolean {
  const endpoint = httpEndpoint(baseUrl)
  if (!endpoint) return false
  const host = endpoint.hostname.toLowerCase()
  return host === 'localhost' || host === 'localhost.' || host === '[::1]'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
}

/** Ollama may also be explicitly hosted on a user's LAN. This is not an offline guarantee. */
export function isLocalOpenAIProfile(model: EndpointProfile): boolean {
  return model.protocol === 'openai'
    && (model.provider === 'ollama' || isLoopbackModelEndpoint(model.baseUrl))
}

export function isModelApiKeyOptional(model: EndpointProfile): boolean {
  return isLocalOpenAIProfile(model)
}

/** Shared by both model settings surfaces; never substitutes for backend validation. */
export function hasModelConnectionFields(model: Pick<ModelProfile,
  'provider' | 'protocol' | 'baseUrl' | 'modelName' | 'apiKey'>): boolean {
  return !!httpEndpoint(model.baseUrl) && !!model.modelName.trim()
    && (isModelApiKeyOptional(model) || !!model.apiKey.trim())
}

/** Do not emit a malformed "Bearer " header for keyless local services. */
export function optionalBearerAuthorization(apiKey: string): Record<string, string> {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : {}
}
