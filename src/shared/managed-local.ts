export type ManagedEngine = 'llamacpp' | 'ollama'
export type ManagedDevice = 'auto' | 'cpu'

export interface ManagedLocalSpec {
  engine: ManagedEngine
  modelId: string
  contextSize: number
  device: ManagedDevice
}
export interface ManagedModel {
  id: string
  name: string
  filePath: string
  sizeBytes: number
  modifiedMs: number
  importedAt: string
  sha256?: string
}
export interface ManagedDownloadSource {
  configured: boolean
  url: string
  extractionCode: string
}
export interface ManagedSnapshot {
  status: 'stopped' | 'starting' | 'ready' | 'stopping' | 'error'
  phase: string
  error: string | null
  activeEngine: ManagedEngine | null
  activeModelId: string | null
  activeRequests: number
  cpuFallback: boolean
  engines: Array<{ id: ManagedEngine; version: string; available: boolean }>
  models: ManagedModel[]
  download: ManagedDownloadSource
}
export type ManagedResult<T> = { success: true; data: T } | { success: false; error: string }

export function validateManagedSpec(value: unknown): ManagedLocalSpec {
  const item = value as Partial<ManagedLocalSpec> | null
  if (!item || !['llamacpp', 'ollama'].includes(String(item.engine))
    || !['auto', 'cpu'].includes(String(item.device))
    || typeof item.modelId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.modelId)
    || !Number.isInteger(item.contextSize) || item.contextSize! < 512 || item.contextSize! > 32768) {
    throw new Error('Invalid managed model configuration')
  }
  return { engine: item.engine!, modelId: item.modelId, contextSize: item.contextSize!, device: item.device! }
}

/** Distribution-owned share-page URL, never a direct executable/model download URL. */
export function parseManagedDownloadSource(value: unknown): ManagedDownloadSource {
  const item = value as { url?: unknown; extractionCode?: unknown } | null
  if (!item || typeof item.url !== 'string' || !item.url.trim()) return { configured: false, url: '', extractionCode: '' }
  const url = new URL(item.url.trim())
  if (url.protocol !== 'https:' || url.hostname !== 'pan.quark.cn' || url.port
    || url.username || url.password || !/^\/s\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new Error('Only an HTTPS pan.quark.cn/s/ share page is allowed')
  }
  const code = typeof item.extractionCode === 'string' ? item.extractionCode.trim() : ''
  if (code && !/^[A-Za-z0-9]{4,16}$/.test(code)) throw new Error('Invalid extraction code')
  return { configured: true, url: url.toString(), extractionCode: code }
}
