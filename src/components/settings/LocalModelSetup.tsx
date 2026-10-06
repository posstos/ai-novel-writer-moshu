import { useEffect, useId, useRef, useState } from 'react'
import type { ModelDiscoveryErrorCode, ModelDiscoveryRequest, ModelDiscoveryResult, DiscoveredModel, ModelProfile } from '../../shared/ipc-channels'
import { LOCAL_MODEL_SERVICES, type LocalModelService } from '../../shared/local-model-profile'
import { createLocalModelProfileDraft } from '../../shared/model-profile-draft'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import { NativeSelect } from '../ui/NativeSelect'

type LocalText = (zh: string, en: string) => string

export function LocalModelHint({ text }: { text: LocalText }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
      {text('本地接口可不填 API Key。请从服务实际安装的模型中选择；生成模型与向量模型需分别配置。上下文窗口应与服务的实际设置一致，而不是模型标称上限。', 'Local endpoints can run without an API key. Choose an installed model and configure generation and embedding models separately. Match the context window to the server configuration, not the model’s advertised maximum.')}
    </p>
  )
}

interface LocalModelSetupProps {
  purposes: ModelProfile['purposes']
  discoverModels: (request: ModelDiscoveryRequest) => Promise<ModelDiscoveryResult>
  onConfigure: (model: ModelProfile) => void
  text: LocalText
}

/** A purpose change gets fresh discovery state and invalidates the previous component's requests. */
export default function LocalModelSetup(props: LocalModelSetupProps) {
  return <LocalModelSetupForm key={props.purposes.join(':')} {...props} />
}

/** Only lists models on explicit request. Does not install, pull, generate, save, or change defaults. */
function LocalModelSetupForm({ purposes, discoverModels, onConfigure, text }: LocalModelSetupProps) {
  const selectId = useId()
  const [service, setService] = useState<LocalModelService>('ollama')
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<ModelDiscoveryErrorCode | null>(null)
  const revision = useRef(0)
  const endpoint = LOCAL_MODEL_SERVICES[service]

  useEffect(() => () => { revision.current += 1 }, [])

  const selectService = (value: LocalModelService) => {
    revision.current += 1
    setService(value)
    setModels([])
    setSelected('')
    setLoading(false)
    setNotice(null)
  }

  const discover = async () => {
    const requestRevision = ++revision.current
    setLoading(true)
    setModels([])
    setSelected('')
    setNotice(null)
    try {
      const result = await discoverModels({ provider: endpoint.provider, baseUrl: endpoint.baseUrl, protocol: 'openai', apiKey: '' })
      if (requestRevision !== revision.current) return
      if (result.success && result.models.length > 0) setModels(result.models)
      else setNotice(result.success ? 'empty' : result.errorCode)
    } catch {
      if (requestRevision === revision.current) setNotice('network')
    } finally {
      if (requestRevision === revision.current) setLoading(false)
    }
  }

  const noticeText = notice === 'empty'
    ? text('服务已响应，但没有可选模型。请先在推理服务中自行下载模型，再重新检测；本应用不会自动下载。', 'The server responded with no models. Download a model in your inference service, then retry. This app will not download it automatically.')
    : notice === 'auth'
      ? text('服务要求鉴权。请使用普通模型表单填写本地服务要求的密钥。', 'The server requires authentication. Use the regular model form to enter its API key.')
      : notice === 'unsupported' || notice === 'invalid_response'
        ? text('服务没有返回兼容的模型列表。请检查 OpenAI-compatible 服务设置，或使用普通表单手动配置。', 'The server did not return a compatible model list. Check its OpenAI-compatible settings or configure it manually in the regular form.')
        : notice === 'network'
          ? text('未连通本地服务。请确认 Ollama 已运行，或 LM Studio 的本地服务器已启动，然后重试。不会回退到云端。', 'Could not reach the local server. Start Ollama or the LM Studio local server, then retry. There is no cloud fallback.')
          : null

  return (
    <section aria-label={text('本地模型快速配置', 'Local model quick setup')}
      className="moshu-local-setup space-y-3 rounded-xl p-4" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        {text('本地开源模型优先', 'Local models first')}
      </h3>
      <LocalModelHint text={text} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={selectId} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {text('本地推理服务', 'Local inference service')}
          </label>
          <NativeSelect id={selectId} value={service} onChange={event => selectService(event.target.value as LocalModelService)}>
            <option value="ollama">Ollama</option>
            <option value="lmstudio">LM Studio</option>
          </NativeSelect>
        </div>
        <Button type="button" variant="outline" onClick={() => void discover()} disabled={loading}>
          {loading ? text('检测中…', 'Checking…') : text('检测本地模型', 'Detect local models')}
        </Button>
      </div>
      <p className="break-all text-xs" style={{ color: 'var(--color-text-muted)' }}>{endpoint.baseUrl}</p>
      {noticeText && <p role="status" className="text-xs" style={{ color: 'var(--color-warning-text)' }}>{noticeText}</p>}
      {models.length > 0 && (
        <div className="space-y-2">
          <p role="status" className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {text('已获取本地列表。列表连通不代表生成已通过；保存前请在表单中测试连接。', 'Local model list received. Listing models does not prove generation works; test the connection in the form before saving.')}
          </p>
          <NativeSelect aria-label={text('已安装的本地模型', 'Installed local models')} value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">{text('请选择适合当前用途的模型', 'Choose a model for this purpose')}</option>
            {models.map(model => <option key={model.value} value={model.value}>{model.name}</option>)}
          </NativeSelect>
          <Button type="button" disabled={loading || !models.some(model => model.value === selected)} onClick={() => {
            if (loading || !models.some(model => model.value === selected)) return
            onConfigure(createLocalModelProfileDraft({ id: randomUUID(), purposes, service, modelName: selected }))
          }}>
            {text('使用此模型填写配置', 'Configure this model')}
          </Button>
        </div>
      )}
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {text('此操作只读取模型列表，不安装服务、不下载模型、不调用生成，也不会修改已有默认模型。未配置向量模型时仍可使用全文检索。', 'This only reads the model list: no service installation, model downloads, generation calls, or changes to existing defaults. Full-text search remains available without an embedding model.')}
      </p>
    </section>
  )
}
