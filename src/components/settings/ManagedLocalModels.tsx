import { useEffect, useId, useRef, useState } from 'react'
import { Download, FolderOpen, Play, Square } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { useLLMStore } from '../../stores/llm-store'
import type { ManagedDevice, ManagedEngine, ManagedSnapshot } from '../../shared/managed-local'
import { Button } from '../ui/Button'
import { NativeSelect } from '../ui/NativeSelect'

type Text = (zh: string, en: string) => string

export function ManagedProfileNotice({ text, onBack }: { text: Text; onBack: () => void }) {
  return <div className="space-y-3 rounded-xl p-4" style={{ border: '1px solid var(--color-border)' }}>
    <p className="text-sm">{text('这是软件管理的内置模型配置。请返回“内置本地模型”面板修改引擎、设备或上下文，再点“启用并设为默认”；不要手动修改临时端口和凭据。', 'This profile is managed by the application. Change its engine, device or context in Embedded local models and activate it again; do not edit temporary endpoints or credentials manually.')}</p>
    <Button type="button" variant="outline" onClick={onBack}>{text('返回内置模型面板', 'Back to embedded models')}</Button>
  </div>
}

export default function ManagedLocalModels({ text }: { text: Text }) {
  const id = useId()
  const [state, setState] = useState<ManagedSnapshot | null>(null)
  const [engine, setEngine] = useState<ManagedEngine>('llamacpp')
  const [device, setDevice] = useState<ManagedDevice>('auto')
  const [context, setContext] = useState(4096)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const actionRevision = useRef(0)
  const snapshotRevision = useRef(0)
  const saveModel = useLLMStore(s => s.saveModel)
  const setDefaultModel = useLLMStore(s => s.setDefaultModel)

  useEffect(() => {
    mounted.current = true
    let inFlight = false
    const refresh = async () => {
      if (!ipc.isElectron || inFlight) return
      inFlight = true
      const revision = ++snapshotRevision.current
      try {
        const result = await ipc.invoke('managed-local:get-state')
        if (mounted.current && revision === snapshotRevision.current && result?.success) setState(result.data)
        else if (mounted.current && result && !result.success) setNotice(result.error)
      } catch { /* Keep the last snapshot; a command reports actionable errors. */ }
      finally { inFlight = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1200)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [])

  const run = async (action: (revision: number) => Promise<void>) => {
    const revision = ++actionRevision.current
    setBusy(true); setNotice('')
    try { await action(revision) }
    catch (error) { if (mounted.current && revision === actionRevision.current) setNotice(text('操作未完成：', 'Operation did not complete: ') + String(error)) }
    finally {
      if (mounted.current && revision === actionRevision.current) {
        setBusy(false)
        const result = await ipc.invoke('managed-local:get-state').catch(() => null)
        if (mounted.current && revision === actionRevision.current && result?.success) setState(result.data)
      }
    }
  }
  const importModel = () => run(async () => {
    const result = await ipc.invoke('managed-local:import-gguf')
    if (!result.success) throw new Error(result.error)
    if (result.data && mounted.current) {
      setSelected(result.data.id)
      setNotice(text('已记录模型位置。选择引擎后点击“启用并设为默认”。', 'Model location recorded. Select an engine, then activate it as the default.'))
    }
  })
  const activate = () => run(async revision => {
    const result = await ipc.invoke('managed-local:activate', { engine, modelId: selected, contextSize: context, device })
    if (!result.success) throw new Error(result.error)
    if (!mounted.current || revision !== actionRevision.current) return
    if (!await saveModel(result.data)) throw new Error(text('模型已加载，但配置保存失败。', 'The model loaded but its profile could not be saved.'))
    if (!mounted.current || revision !== actionRevision.current) return
    if (!await setDefaultModel(result.data.id)) throw new Error(text('无法保存默认模型。', 'Could not save the default model.'))
    if (mounted.current) setNotice(text('已启用并设为默认，可以返回作品开始写作。下次使用会自动启动内置引擎。', 'Activated as the default. Return to your project to write; future requests start the embedded engine automatically.'))
  })
  const stop = () => run(async () => {
    const result = await ipc.invoke('managed-local:stop')
    if (!result.success) throw new Error(result.error)
    if (mounted.current) setState(result.data)
  })
  const download = () => run(async () => {
    const result = await ipc.invoke('managed-local:open-download')
    if (!result.success) throw new Error(result.error)
  })
  const available = state?.engines.find(item => item.id === engine)?.available ?? false
  const stateLabel = state?.status === 'ready' ? text('模型已就绪', 'Model ready')
    : state?.status === 'starting' ? text('正在校验或加载模型…', 'Checking or loading the model…')
      : state?.status === 'stopping' ? text('正在停止…', 'Stopping…')
        : state?.status === 'error' ? text('启动未完成', 'Startup did not complete')
          : text('未启动 · 使用时自动加载', 'Stopped · loads on use')

  return (
    <section aria-label={text('内置本地模型', 'Embedded local models')} className="space-y-3 rounded-xl p-4" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{text('内置本地模型', 'Embedded local models')}</h3>
        <span className="text-xs" role="status">{stateLabel}</span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        {text('下载完整 GGUF → 导入 → 启用。已内置 Ollama 与 llama.cpp，不用另装推理软件或填写服务地址。', 'Download a complete GGUF → import → activate. Ollama and llama.cpp are bundled; no separate inference app or endpoint setup is needed.')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void download()} disabled={busy || !state?.download.configured}>
          <Download size={14} />{text('夸克网盘下载模型', 'Download models from Quark')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void importModel()} disabled={busy || !ipc.isElectron}>
          <FolderOpen size={14} />{text('导入 GGUF 文件', 'Import a GGUF file')}
        </Button>
      </div>
      {state && !state.download.configured && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{text('夸克下载地址暂未配置，等待发布者提供。已有模型可以直接导入。', 'The publisher has not provided the Quark link yet. Existing models can still be imported.')}</p>}
      {state?.download.extractionCode && <p className="text-xs">{text('网盘提取码：', 'Share access code: ')}<code>{state.download.extractionCode}</code></p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label htmlFor={id + '-engine'} className="text-xs">{text('内置推理引擎', 'Embedded inference engine')}
          <NativeSelect id={id + '-engine'} value={engine} disabled={busy} onChange={event => setEngine(event.target.value as ManagedEngine)}>
            <option value="llamacpp">{text('llama.cpp（直接读取 GGUF）', 'llama.cpp (direct GGUF loading)')}</option>
            <option value="ollama">{text('Ollama（首次建立独立缓存）', 'Ollama (creates a private cache on first use)')}</option>
          </NativeSelect>
        </label>
        <label htmlFor={id + '-device'} className="text-xs">{text('计算设备', 'Compute device')}
          <NativeSelect id={id + '-device'} value={device} disabled={busy} onChange={event => setDevice(event.target.value as ManagedDevice)}>
            <option value="auto">{text('自动 · 失败时尝试 CPU', 'Automatic · try CPU on failure')}</option>
            <option value="cpu">{text('仅 CPU（较慢但兼容性较好）', 'CPU only (slower, broader compatibility)')}</option>
          </NativeSelect>
        </label>
      </div>
      <label htmlFor={id + '-model'} className="block text-xs">{text('已导入的写作模型', 'Imported writing model')}
        <NativeSelect id={id + '-model'} value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
          <option value="">{text('请选择已导入的 GGUF', 'Select an imported GGUF')}</option>
          {state?.models.map(model => <option key={model.id} value={model.id}>{model.name} · {(model.sizeBytes / 1024 ** 3).toFixed(2)} GiB</option>)}
        </NativeSelect>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={id + '-context'} className="min-w-28 text-xs">{text('上下文 tokens', 'Context tokens')}
          <NativeSelect id={id + '-context'} value={context} disabled={busy} onChange={event => setContext(Number(event.target.value))}>
            {[2048, 4096, 8192, 16384, 32768].map(size => <option key={size} value={size}>{size}</option>)}
          </NativeSelect>
        </label>
        <Button type="button" size="sm" onClick={() => void activate()} disabled={busy || !available || !selected || (state?.activeRequests ?? 0) > 0}>
          <Play size={14} />{text('启用并设为默认', 'Activate and set as default')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void stop()} disabled={!state || !['starting', 'ready', 'error'].includes(state.status) || state.activeRequests > 0}>
          <Square size={14} />{text('停止内置引擎', 'Stop embedded engine')}
        </Button>
      </div>
      {state && !available && <p className="text-xs" style={{ color: 'var(--color-warning-text)' }}>{text('此副本缺少完整运行库，请使用带内置引擎的完整发行包。', 'This copy is missing the runtime. Use the complete release with embedded engines.')}</p>}
      {state?.phase.startsWith('hashing-model-') && <p className="text-xs">{text('正在校验模型文件：', 'Hashing model file: ')}{state.phase.slice('hashing-model-'.length)}%</p>}
      {state?.cpuFallback && <p className="text-xs">{text('GPU 路径未完成加载，已尝试 CPU 兼容模式。', 'GPU loading did not complete; CPU compatibility mode was attempted.')}</p>}
      {(notice || state?.error) && <p className="break-words text-xs" role="status" style={{ color: 'var(--color-warning-text)' }}>{notice || state?.error}</p>}
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        {text('导入仅记录原文件位置，不复制或删除文件，请勿移动它。Ollama 首次导入另需模型缓存空间；内存不足请降低上下文或使用小模型。当前支持受引擎识别的完整单文件 GGUF 写作模型，向量模型仍在下方单独配置。', 'Import records the original file location without copying or deleting it; keep the file in place. Ollama needs extra cache space on first use. Reduce context or model size if memory is insufficient. Complete, engine-supported single-file GGUF writing models are supported; configure embedding models separately.')}
      </p>
    </section>
  )
}
