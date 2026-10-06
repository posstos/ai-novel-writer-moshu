import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react'
import {
  CheckCircle2,
  CircleDot,
  BookOpenCheck,
  FilePlus2,
  FolderOpen,
  Import,
  Languages,
  Minus,
  Moon,
  ScrollText,
  Settings,
  Sparkles,
  Square,
  Sun,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import { useEditorStore } from '../../stores/editor-store'
import { saveDirtyEditorChangesForExit } from '../../stores/editor-store'
import { countUnsavedEditorItems } from '../../stores/editor-unsaved'
import { discardAllEditorChanges } from '../../stores/editor-discard'
import { useLayoutStore } from '../../stores/layout-store'
import BrandMark from '../brand/BrandMark'
import { APP_BRAND } from '../../shared/brand'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import type { MessageKey } from '../../i18n/core'
import { sameProjectPathKey } from '../../shared/project-session-context'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { alertError } from '../ui/AlertDialog'

const isMac = navigator.userAgent.includes('Mac')

const themeIcons: Record<Theme, typeof Sun> = {
  light: Sun,
  galaxy: Sparkles,
  paper: ScrollText,
  dark: Moon,
}
const themeOrder: Theme[] = ['galaxy', 'dark', 'light', 'paper']
const themeLabelKeys: Record<Theme, MessageKey> = {
  light: 'theme.light',
  galaxy: 'theme.galaxy',
  paper: 'theme.paper',
  dark: 'theme.dark',
}

export default function TitleBar() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const openProject = useProjectStore((s) => s.openProject)
  const { theme, setTheme } = useThemeStore()
  const { zoom, zoomIn, zoomOut, zoomReset } = useThemeStore()
  const hasDirty = useEditorStore((s) => countUnsavedEditorItems(s.tabs, s.draftLedgers) > 0)
  const openGuide = useLayoutStore(s => s.openGuide)
  const openSettings = useLayoutStore(s => s.openSettings)
  const openNewProject = useLayoutStore(s => s.openNewProject)
  const openExport = useLayoutStore(s => s.openExport)
  const openImportNovel = useLayoutStore(s => s.openImportNovel)
  const { locale, toggleLocale, t, text } = useLocaleStore()
  const [exitRequest, setExitRequest] = useState<{ requestId: string; workflowBlocked?: boolean } | null>(null)
  const [exitBusy, setExitBusy] = useState(false)
  const [exitError, setExitError] = useState<string | null>(null)

  useEffect(() => ipc.on('window:close-requested', ({ requestId }) => {
    const projectPath = useProjectStore.getState().currentProject?.path
    const hasActiveWorkflow = !!projectPath && useWorkflowStore.getState().activeRuns.some(
      run => sameProjectPathKey(run.projectPath, projectPath),
    )
    if (hasActiveWorkflow) {
      setExitError(null)
      setExitRequest({ requestId, workflowBlocked: true })
      return
    }
    const editor = useEditorStore.getState()
    if (countUnsavedEditorItems(editor.tabs, editor.draftLedgers) === 0) {
      void ipc.invoke('window:resolve-close', requestId, 'proceed').then(result => {
        if (!result.success) console.error('[TitleBar] 退出请求已失效')
      }).catch(error => console.error('[TitleBar] 退出请求失败:', error))
      return
    }
    setExitError(null)
    setExitRequest({ requestId })
  }), [])

  const cancelExit = async () => {
    const request = exitRequest
    if (!request || exitBusy) return
    setExitBusy(true)
    try {
      const result = await ipc.invoke('window:resolve-close', request.requestId, 'cancel')
      if (!result.success) throw new Error(text('退出请求已失效，请重试', 'The exit request expired. Try again.'))
      setExitRequest(null)
      setExitError(null)
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error))
    } finally {
      setExitBusy(false)
    }
  }

  const discardAndExit = async () => {
    const request = exitRequest
    if (!request || request.workflowBlocked || exitBusy) return
    setExitBusy(true)
    setExitError(null)
    try {
      const result = await ipc.invoke('window:resolve-close', request.requestId, 'cancel')
      if (!result.success) throw new Error(text('退出请求已失效，请重试', 'The exit request expired. Try again.'))
      discardAllEditorChanges()
      setExitRequest(null)
      const closeResult = await ipc.invoke('window:close')
      if (!closeResult.success) {
        await alertError(
          text('未保存修改已放弃，但无法再次发起退出。请手动重试退出。', 'Unsaved changes were discarded, but exit could not be requested again. Try exiting again.'),
          { title: text('退出失败', 'Could not exit') },
        )
      }
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error))
    } finally {
      setExitBusy(false)
    }
  }

  const saveAndExit = async () => {
    const request = exitRequest
    if (!request || request.workflowBlocked || exitBusy) return
    setExitBusy(true)
    setExitError(null)
    try {
      await saveDirtyEditorChangesForExit(useProjectStore.getState().currentProject?.path)
      const result = await ipc.invoke('window:resolve-close', request.requestId, 'proceed')
      if (!result.success) throw new Error(text('退出请求已失效，请重试', 'The exit request expired. Try again.'))
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error))
    } finally {
      setExitBusy(false)
    }
  }

  const ThemeIcon = themeIcons[theme] || Sun
  const cycleTheme = (e: MouseEvent) => {
    const nextTheme = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]

    if (
      !('startViewTransition' in document) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setTheme(nextTheme)
      return
    }

    const x = e.clientX
    const y = e.clientY
    const endRadius = Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y)
    )

    const transition = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }).startViewTransition!(() => {
      setTheme(nextTheme)
    })

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ]

      document.documentElement.animate(
        { clipPath },
        {
          duration: 450,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    })
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-') {
        e.preventDefault()
        zoomOut()
      } else if (e.key === '0') {
        e.preventDefault()
        zoomReset()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [zoomIn, zoomOut, zoomReset])

  const handleOpenProject = async () => {
    const folder = await ipc.invoke('dialog:select-folder')
    if (folder) {
      openProject(folder)
    }
  }

  const zoomLabel = `${Math.round(zoom * 100)}%`

  return (
    <>
      <div className="writer-topbar moshu-titlebar no-select flex items-center gap-2"
        style={{ height: 'var(--height-titlebar)', paddingLeft: isMac ? 78 : 16, paddingRight: 10, WebkitAppRegion: 'drag' } as CSSProperties}>
        <div className="moshu-title-brand">
          <span className="moshu-logo-tile"><BrandMark /></span>
          <div><strong>{text(APP_BRAND.zhName, APP_BRAND.enName)}</strong><small>{text('MOSHU · 私人书房', 'PRIVATE WRITING ROOM')}</small></div>
        </div>
        <div className="moshu-title-project">
          <button type="button" className="writer-command-button max-w-[240px] min-w-0" title={t('project.switch')} onClick={handleOpenProject}>
            <FolderOpen size={15} className="shrink-0" /><span className="truncate">{currentProject?.name ?? text('创作工作台', 'Writing desk')}</span>
          </button>
          {currentProject && <span className="moshu-save-status" role="status" title={hasDirty ? t('save.dirty') : t('save.saved')}
            style={{ color: hasDirty ? 'var(--color-warning-text)' : 'var(--color-success-text)' }}>
            {hasDirty ? <CircleDot size={13} /> : <CheckCircle2 size={13} />}{hasDirty ? t('save.modified') : t('save.saved')}
          </span>}
        </div>
        <div className="moshu-file-actions">
          <button type="button" className="writer-command-button" title={t('project.new')} onClick={openNewProject}><FilePlus2 size={15} /><span className="moshu-action-label">{t('common.new')}</span></button>
          <button type="button" className="writer-command-button" title={t('project.open')} onClick={handleOpenProject}><FolderOpen size={15} /><span className="moshu-action-label">{t('common.open')}</span></button>
          <button type="button" className="writer-command-button" title={t('project.imitation')} onClick={openImportNovel}><Import size={15} /><span className="moshu-action-label">{t('project.imitationShort')}</span></button>
          <button type="button" className="writer-command-button" title={t('project.export')} disabled={!currentProject} onClick={openExport}><Upload size={15} /><span className="moshu-action-label">{t('common.export')}</span></button>
        </div>
        <div className="moshu-title-actions">
          <span className="writer-command-divider h-5 w-px" />
          <button type="button" className="writer-command-button" title={text('使用指南', 'Getting started')} onClick={openGuide}><BookOpenCheck size={16} /></button>
          <div className="moshu-zoom-controls">
            <button type="button" className="writer-command-button" title={t('zoom.out')} onClick={zoomOut}><ZoomOut size={14} /></button>
            <button type="button" className="writer-command-button" title={t('zoom.reset')} onClick={zoomReset}>{zoomLabel}</button>
            <button type="button" className="writer-command-button" title={t('zoom.in')} onClick={zoomIn}><ZoomIn size={14} /></button>
          </div>
          <button type="button" className="writer-command-button" title={t('theme.label', { name: t(themeLabelKeys[theme]) })} onClick={cycleTheme}><ThemeIcon size={15} /></button>
          <button type="button" className="writer-command-button" title={t('language.switch')} onClick={() => void toggleLocale()}><Languages size={15} /><span>{locale === 'zh-CN' ? 'EN' : '中文'}</span></button>
          <button type="button" className="writer-command-button" title={t('common.settings')} onClick={() => openSettings()}><Settings size={16} /></button>
          <span className="writer-command-divider h-5 w-px" />
          <button type="button" className="writer-command-button" title={t('common.minimize')} onClick={() => ipc.invoke('window:minimize')}><Minus size={15} /></button>
          <button type="button" className="writer-command-button" title={t('common.maximizeRestore')} onClick={() => ipc.invoke('window:toggle-maximize')}><Square size={13} /></button>
          <button type="button" className="writer-command-button moshu-window-close" title={t('common.close')} onClick={() => ipc.invoke('window:close')}><X size={16} /></button>
        </div>
      </div>
      <Dialog open={exitRequest !== null} onOpenChange={(open) => {
        if (!open) void cancelExit()
      }}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{exitRequest?.workflowBlocked
              ? text('创作任务仍在运行', 'Creative task still running')
              : text('退出前处理未保存内容', 'Handle unsaved changes before exiting')}</DialogTitle>
            <DialogDescription>
              {exitRequest?.workflowBlocked
                ? text('请先等待当前创作任务完成，或在任务面板中取消任务后再退出。', 'Wait for the current creative task to finish, or cancel it in the task panel before exiting.')
                : text(
                    '保存会使用每个编辑器现有的项目会话；无法安全保存或保存期间又有输入时，应用不会退出。',
                    'Each editor saves through its existing project session. The app stays open if a save is unsafe or new input arrives while saving.',
                  )}
            </DialogDescription>
          </DialogHeader>
          {exitError && (
            <p className="text-sm" style={{ color: 'var(--color-error-text)' }}>{exitError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void cancelExit()} disabled={exitBusy}>
              {exitRequest?.workflowBlocked ? text('知道了', 'OK') : text('取消', 'Cancel')}
            </Button>
            {!exitRequest?.workflowBlocked && (
              <>
                <Button variant="destructive" onClick={() => void discardAndExit()} disabled={exitBusy}>
                  {text('放弃并退出', 'Discard and exit')}
                </Button>
                <Button onClick={() => void saveAndExit()} disabled={exitBusy}>
                  {exitBusy ? text('处理中...', 'Working...') : text('保存并退出', 'Save and exit')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
