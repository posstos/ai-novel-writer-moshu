import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import ManagedLocalModels from '../ManagedLocalModels'
import { parseManagedDownloadSource } from '../../../shared/managed-local'
const source = (name: string) => readFileSync(name, 'utf8')
describe('embedded model UI and packaging contract', () => {
  it('renders the Quark entry and GGUF workflow without a premature missing-link message', () => {
    const html = renderToStaticMarkup(<ManagedLocalModels text={zh => zh} />)
    expect(html).toContain('夸克网盘下载模型'); expect(html).toContain('导入 GGUF 文件')
    expect(html).toContain('启用并设为默认'); expect(html).toContain('Ollama'); expect(html).toContain('llama.cpp')
    expect(html).toContain('仅 CPU'); expect(html).not.toContain('夸克下载地址暂未配置')
  })
  it('uses the configured Quark share URL and ships the pinned offline engine payload', () => {
    const config = JSON.parse(source('packaging/model-download.json'))
    const url = 'https://pan.quark.cn/s/e24917c4ebbd'
    expect(config.url).toBe(url); expect(config.extractionCode).toBe('')
    expect(parseManagedDownloadSource(config)).toEqual({ configured: true, url, extractionCode: '' })
    expect(source('src/components/settings/ManagedLocalModels.tsx')).toContain('disabled={busy || !state?.download.configured}')
    const packaging = source('electron-builder.moshu.cjs')
    expect(packaging).toContain("to: 'engines'")
    expect(packaging).toContain("to: 'model-download.json'")
    expect(source('packaging/embedded-runtime-pins.json')).toContain('535193f38f3344e5b08f5d1c171c31ce11aa17f0124ff69ae26d8ec7fe06fa62')
  })
  it('places the new panel in both generation settings surfaces', () => {
    expect(source('src/components/settings/ModelSettings.tsx')).toContain('<ManagedLocalModels text={text}')
    expect(source('src/components/settings/SettingsModal.tsx')).toContain('!isEmbeddingSection && <ManagedLocalModels')
  })
  it('never accepts a raw renderer command, download URL or file path for engine launch', () => {
    const controller = source('electron/controllers/managed-local-controller.ts')
    expect(controller).toContain('dialog.showOpenDialog')
    expect(controller).toContain('isTrustedManagedSender')
    expect(controller).toContain('validateManagedSpec(value)')
    expect(controller).not.toContain('shell.openExternal(value')
    expect(source('electron/services/managed-local/process.ts')).toContain('shell: false')
    expect(source('electron/llm/openai-provider.ts')).toContain("model.managedLocal ? { redirect: 'error'")
  })
})
