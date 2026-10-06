import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LocalModelSetup from '../LocalModelSetup'
import type { ModelDiscoveryRequest, ModelDiscoveryResult, ModelProfile } from '../../../shared/ipc-channels'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
const en = (_zh: string, english: string) => english
const zh = (chinese: string) => chinese

async function renderSetup(
  discoverModels: (request: ModelDiscoveryRequest) => Promise<ModelDiscoveryResult>,
  onConfigure = vi.fn(),
  text = en,
  purposes: ModelProfile['purposes'] = ['generation'],
) {
  if (!container) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root!.render(<LocalModelSetup purposes={purposes} discoverModels={discoverModels} onConfigure={onConfigure} text={text} />))
  return onConfigure
}
function button(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll('button')).find(element => element.textContent === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
async function click(label: string) { await act(async () => { button(label).click() }) }
async function select(label: string, value: string) {
  const node = label === 'service' ? container!.querySelector('select') : container!.querySelector(`select[aria-label="${label}"]`)
  if (!(node instanceof HTMLSelectElement)) throw new Error('Missing select: ' + label)
  await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })) })
}
const available: ModelDiscoveryResult = { success: true, models: [{ id: 'writer:7b', name: 'Local writer', value: 'writer:7b' }] }

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
})

describe('local model quick setup', () => {
  it('does nothing on mount and requires an explicitly selected installed model before opening a draft', async () => {
    const discover = vi.fn<(request: ModelDiscoveryRequest) => Promise<ModelDiscoveryResult>>().mockResolvedValue(available)
    const configure = await renderSetup(discover)
    expect(discover).not.toHaveBeenCalled()
    expect(configure).not.toHaveBeenCalled()
    await click('Detect local models')
    expect(discover).toHaveBeenCalledExactlyOnceWith({ provider: 'ollama', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' })
    expect(button('Configure this model').disabled).toBe(true)
    await select('Installed local models', 'writer:7b')
    await click('Configure this model')
    expect(configure).toHaveBeenCalledOnce()
    expect(configure.mock.calls[0][0]).toMatchObject({ provider: 'ollama', modelName: 'writer:7b', apiKey: '', maxTokens: 2048, purposes: ['generation'] })
    // The callback opens an unsaved draft; no save/default/inference API is available to this component.
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('creates a keyless LM Studio draft without reusing an Ollama model selection', async () => {
    const discover = vi.fn<(request: ModelDiscoveryRequest) => Promise<ModelDiscoveryResult>>().mockResolvedValue(available)
    const configure = await renderSetup(discover)
    await click('Detect local models')
    await select('Installed local models', 'writer:7b')
    await select('service', 'lmstudio')
    expect(container!.querySelector('[aria-label="Installed local models"]')).toBeNull()
    await click('Detect local models')
    expect(discover.mock.calls[1][0]).toMatchObject({ provider: 'custom', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '' })
    await select('Installed local models', 'writer:7b')
    await click('Configure this model')
    expect(configure.mock.calls[0][0]).toMatchObject({ provider: 'custom', baseUrl: 'http://127.0.0.1:1234/v1', modelName: 'writer:7b' })
  })

  it('shows an actionable missing-service notice without a cloud request', async () => {
    const discover = vi.fn(async (): Promise<ModelDiscoveryResult> => ({ success: false, errorCode: 'network' }))
    const configure = await renderSetup(discover)
    await click('Detect local models')
    expect(container!.textContent).toContain('There is no cloud fallback')
    expect(button('Detect local models').disabled).toBe(false)
    expect(discover).toHaveBeenCalledTimes(1)
    expect(configure).not.toHaveBeenCalled()
  })

  it('handles an IPC rejection and lets the user retry', async () => {
    const discover = vi.fn().mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValueOnce(available)
    await renderSetup(discover)
    await click('Detect local models')
    expect(container!.textContent).toContain('Could not reach the local server')
    await click('Detect local models')
    expect(container!.querySelector('[aria-label="Installed local models"]')).not.toBeNull()
  })

  it('distinguishes an empty model list from an offline service in Chinese', async () => {
    const discover = vi.fn(async (): Promise<ModelDiscoveryResult> => ({ success: false, errorCode: 'empty' }))
    const configure = await renderSetup(discover, vi.fn(), zh)
    await click('检测本地模型')
    expect(container!.textContent).toContain('服务已响应，但没有可选模型')
    expect(container!.textContent).toContain('本应用不会自动下载')
    expect(configure).not.toHaveBeenCalled()
  })

  it('ignores a late Ollama response after switching to LM Studio', async () => {
    let resolveOld!: (result: ModelDiscoveryResult) => void
    const old = new Promise<ModelDiscoveryResult>(resolve => { resolveOld = resolve })
    const discover = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce({ success: true, models: [{ id: 'new-model', name: 'New model', value: 'new-model' }] })
    await renderSetup(discover)
    await click('Detect local models')
    await select('service', 'lmstudio')
    await click('Detect local models')
    await act(async () => { resolveOld(available); await old })
    expect(container!.textContent).toContain('New model')
    expect(container!.textContent).not.toContain('Local writer')
    expect(button('Configure this model').disabled).toBe(true)
  })

  it('resets discovery when the purpose changes and preserves the embedding purpose', async () => {
    const discover = vi.fn<(request: ModelDiscoveryRequest) => Promise<ModelDiscoveryResult>>().mockResolvedValue(available)
    const configure = await renderSetup(discover)
    await click('Detect local models')
    await select('Installed local models', 'writer:7b')
    await renderSetup(discover, configure, en, ['embedding'])
    expect(container!.querySelector('[aria-label="Installed local models"]')).toBeNull()
    await click('Detect local models')
    await select('Installed local models', 'writer:7b')
    await click('Configure this model')
    expect(configure.mock.calls[0][0]).toMatchObject({ purposes: ['embedding'], maxTokens: 0, embeddingOptions: { batchSize: 4 } })
  })
})
