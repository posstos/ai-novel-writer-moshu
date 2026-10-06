import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLLMStore } from '../../../stores/llm-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { createModelProfileDraft } from '../../../shared/model-profile-draft'
import type { ModelProfile } from '../../../shared/ipc-channels'
import SettingsModal from '../SettingsModal'
import ModelSettings from '../ModelSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const originalLLM = useLLMStore.getState()
const originalLayout = useLayoutStore.getState()
const originalLocale = useLocaleStore.getState()
let root: Root | undefined
let container: HTMLDivElement | undefined

type Surface = 'modal' | 'sidebar'
async function renderSurface(surface: Surface, existing = true) {
  const saved = { ...createModelProfileDraft({ id: 'saved-cloud', purposes: ['generation'], provider: 'openai' }), name: 'Saved cloud model', apiKey: 'never-forward-this-key' }
  const saveModel = vi.fn<(model: ModelProfile) => Promise<boolean>>().mockResolvedValue(true)
  const setDefaultModel = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true)
  const discoverModels = vi.fn(async () => ({ success: true as const, models: [{ id: 'installed-writer', name: 'Installed writer', value: 'installed-writer' }] }))
  useLLMStore.setState({ models: existing ? [saved] : [], defaultModelId: existing ? saved.id : null, loaded: true, saveModel, setDefaultModel, discoverModels })
  useLayoutStore.setState({ settingsSection: 'llm' })
  useLocaleStore.setState({ locale: 'zh-CN' })
  Object.defineProperty(window, 'velaAPI', { configurable: true, value: { invoke: vi.fn(async () => ({})) } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(surface === 'modal' ? <SettingsModal open onClose={() => {}} /> : <ModelSettings />))
  return { saved, saveModel, setDefaultModel, discoverModels }
}
// Modal contents are portaled; the sidebar remains inside the render container.
function surfaceRoot(): Element { return document.querySelector('[role="dialog"]') ?? container! }
function findButton(name: string) {
  const found = Array.from(surfaceRoot().querySelectorAll('button')).find(button => button.textContent === name || button.title === name)
  if (!found) throw new Error('Missing button: ' + name)
  return found
}
async function click(name: string) { await act(async () => { findButton(name).click() }) }
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function localDraft() {
  await click('检测本地模型')
  await choose(surfaceRoot().querySelector<HTMLSelectElement>('select[aria-label="已安装的本地模型"]')!, 'installed-writer')
  await click('使用此模型填写配置')
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useLLMStore.setState(originalLLM)
  useLayoutStore.setState(originalLayout)
  useLocaleStore.setState(originalLocale)
  Reflect.deleteProperty(window, 'velaAPI')
})

describe('local profiles in both settings surfaces', () => {
  it.each(['modal', 'sidebar'] as const)('%s saves a keyless local draft without replacing or mutating an existing cloud default', async surface => {
    const { saved, saveModel, setDefaultModel, discoverModels } = await renderSurface(surface)
    expect(discoverModels).not.toHaveBeenCalled()
    await localDraft()
    const save = findButton(surface === 'modal' ? '保存配置' : '保存')
    expect(save.disabled).toBe(false)
    expect(findButton('测试连接').disabled).toBe(false)
    expect(surfaceRoot().querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
    await act(async () => { save.click() })
    expect(saveModel).toHaveBeenCalledOnce()
    expect(saveModel.mock.calls[0][0]).toMatchObject({ provider: 'ollama', modelName: 'installed-writer', apiKey: '', maxTokens: 2048 })
    expect(setDefaultModel).not.toHaveBeenCalled()
    expect(useLLMStore.getState().defaultModelId).toBe(saved.id)
    expect(useLLMStore.getState().models[0]).toEqual(saved)
    expect(saved.apiKey).toBe('never-forward-this-key')
  })

  it.each(['modal', 'sidebar'] as const)('%s changes protocol, endpoint and model together and does not carry credentials across providers', async surface => {
    const { saved } = await renderSurface(surface)
    await click('编辑')
    expect(surfaceRoot().querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(saved.apiKey)
    await choose(surfaceRoot().querySelector('select')!, 'gemini')
    expect(surfaceRoot().querySelectorAll('select')[1].value).toBe('gemini')
    expect(surfaceRoot().querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
    await choose(surfaceRoot().querySelector('select')!, 'ollama')
    expect(surfaceRoot().querySelectorAll('select')[1].value).toBe('openai')
    expect(Array.from(surfaceRoot().querySelectorAll('input')).some(input => input.value === 'http://127.0.0.1:11434/v1')).toBe(true)
    expect(findButton(surface === 'modal' ? '保存配置' : '保存').disabled).toBe(true)
    expect(findButton('测试连接').disabled).toBe(true)
    expect(useLLMStore.getState().models[0]).toEqual(saved)
  })

  it.each(['modal', 'sidebar'] as const)('%s establishes the first generation default only after a successful explicit save', async surface => {
    const { saveModel, setDefaultModel } = await renderSurface(surface, false)
    await localDraft()
    expect(saveModel).not.toHaveBeenCalled()
    expect(setDefaultModel).not.toHaveBeenCalled()
    await click(surface === 'modal' ? '保存配置' : '保存')
    expect(saveModel).toHaveBeenCalledOnce()
    expect(setDefaultModel).toHaveBeenCalledExactlyOnceWith(saveModel.mock.calls[0][0].id)
  })
})
