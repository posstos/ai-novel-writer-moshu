import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { useLayoutStore } from '../../stores/layout-store'
import { APP_BRAND } from '../brand'
const source = (path: string) => readFileSync(path, 'utf8')

describe('Moshu display identity and data compatibility', () => {
  it('changes the display identity, not the package or installer identity', () => {
    expect(APP_BRAND.zhName).toBe('墨墅')
    expect(JSON.parse(source('package.json')).name).toBe('ai-novel-writer')
    expect(source('electron-builder.json5')).toContain('"appId": "com.ai-novel-writer.app"')
    expect(source('electron-builder.json5')).toContain('"productName": "AI小说作家"')
    expect(source('electron/main.ts')).not.toMatch(/app\.set(Name|Path)\(/)
  })
  it('keeps theme preferences and the global workspace on the original keys', () => {
    expect(source('src/stores/theme-store.ts')).toContain("name: 'ai-novel-writer-theme'")
    expect(source('index.html')).toContain("localStorage.getItem('ai-novel-writer-theme')")
    expect(source('electron/utils/config-utils.ts')).toContain("path.join(os.homedir(), '.vela')")
  })
  it('uses the new brand in both native window-title locales and the splash', () => {
    expect(source('index.html')).toContain('墨墅 · 私人小说创作室')
    expect(source('src/i18n/messages/zh-CN.ts')).toContain('墨墅 · 私人小说创作室')
    expect(source('src/i18n/messages/en-US.ts')).toContain('Moshu — Your private writing room')
  })
  it('uses a bundled icon and leaves the launcher behavior intact', () => {
    expect(source('electron/main.ts')).toContain("path.join(process.env.VITE_PUBLIC!, 'moshu-icon.png')")
    expect(readFileSync('public/moshu-icon.png').subarray(1, 4).toString()).toBe('PNG')
    expect(source('一键启动.bat')).toContain('title Moshu - Local Launcher')
    expect(source('scripts/start-local-windows.ps1')).toContain('Start AI Novel Writer')
  })
})

describe('Moshu onboarding and workspace contracts', () => {
  it('starts with a spacious home, without changing model defaults', () => {
    const layout = useLayoutStore.getInitialState()
    expect(layout.sidebarView).toBe('home')
    expect(layout.sidebarOpen).toBe(false)
    expect(layout.aiPanelOpen).toBe(false)
    expect(layout.bottomPanelOpen).toBe(false)
    expect(source('src/stores/project-store.ts')).toContain("sidebarView: 'project', activeRailItem: 'project'")
    expect(source('src/components/pages/WelcomePage.tsx')).not.toContain('setDefaultModel')
  })
  it('opens help without routing away from an editor or project', () => {
    const before = useLayoutStore.getState()
    before.openGuide()
    expect(useLayoutStore.getState().guideOpen).toBe(true)
    expect(useLayoutStore.getState().sidebarView).toBe(before.sidebarView)
    useLayoutStore.getState().closeGuide()
    expect(useLayoutStore.getState().guideOpen).toBe(false)
  })
  it('uses explicit panel units and actually collapses the bottom panel', () => {
    const app = source('src/App.tsx')
    expect(app).not.toMatch(/defaultSize=\{\d+\}/)
    expect(app).toContain('collapsedSize="0%"')
    expect(app).toContain('bottomPanelRef.current?.collapse()')
    expect(app).toContain('lastBottomSize')
  })
  it('does not run discovery, generation or installation from help', () => {
    const guide = source('src/components/help/UserGuide.tsx')
    expect(guide).not.toMatch(/ipc\.invoke|fetch\(|startWorkflow\(|discoverModels\(/)
    expect(guide).toContain('此功能只导出已定稿章节')
    expect(source('docs/moshu-guide.md')).toContain('导出只包含已定稿章节')
  })
  it('keeps project removal and real deletion as separate confirmed operations', () => {
    const home = source('src/components/panels/sidebar/HomeSidebarPanel.tsx')
    expect(home).toContain('只会移除列表记录，不会删除项目文件')
    expect(home).toContain('danger: true')
    expect(home).toContain('deleteProject(project.path)')
    expect(home).toContain('removeRecentProject(project.path)')
  })
  it('supports keyboard settings entry without passing a mouse event as a section', () => {
    expect(source('src/components/layout/LeftToolWindowBar.tsx')).toContain('onClick={() => onClick()}')
    expect(source('src/components/layout/StatusBar.tsx')).toContain("const Component = onClick ? 'button' : 'div'")
    expect(source('src/components/layout/StatusBar.tsx')).toContain('onClick ? () => onClick() : undefined')
    expect(source('src/components/settings/SettingsModal.tsx')).toContain('<Dialog open={open}')
  })
})
