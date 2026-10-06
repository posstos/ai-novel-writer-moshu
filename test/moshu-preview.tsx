import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../src/App'
import { useLocaleStore } from '../src/stores/locale-store'
import { useProjectStore } from '../src/stores/project-store'
import { useLayoutStore } from '../src/stores/layout-store'
import { useThemeStore } from '../src/stores/theme-store'
import { useLLMStore } from '../src/stores/llm-store'
import { useEditorStore } from '../src/stores/editor-store'
import '../src/index.css'
import '../src/styles/moshu.css'
// Browser preview only: no injected Electron bridge, file access, or model requests.
const params = new URLSearchParams(location.search)
useProjectStore.setState({ loadRecentProjects: async () => {} })
useLocaleStore.setState({ locale: params.get('lang') === 'en' ? 'en-US' : 'zh-CN', init: async () => {} })
if (params.get('shelf') === 'sample') useProjectStore.setState({ recentProjects: [
  { name: '风停在山海之间', path: '示例书架 / 风停在山海之间', updatedAt: new Date().toISOString() },
  { name: '长安夜雨', path: '示例书架 / 长安夜雨', updatedAt: new Date().toISOString() },
] })
Object.assign(window, { moshuPreview: { project: useProjectStore, layout: useLayoutStore, theme: useThemeStore, llm: useLLMStore, editor: useEditorStore } })
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
const notice = document.createElement('div')
notice.textContent = '界面预览 · 不连接你的本地文件与模型'
notice.style.cssText = 'position:fixed;bottom:3px;left:50%;transform:translateX(-50%);z-index:40;font:10px system-ui;color:var(--color-text-muted);pointer-events:none;'
document.body.append(notice)
