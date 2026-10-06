import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { MANUAL_DISTRIBUTION_UPDATES } from '../src/shared/distribution'
import { claimMoshuPackageSmoke, moshuPackageSmokeWasRequested, verifyMoshuHiddenWindow } from './services/moshu-package-smoke'
import { registerIPCHandlers } from './ipc-handlers'
import { registerMCPHandlers } from './mcp/mcp-ipc-bridge'
import { mainT } from './i18n'
import { registerUpdateController } from './controllers/update-controller'
import { createElectronUpdaterBackend } from './services/electron-updater-adapter'
import {
  GITHUB_LATEST_RELEASE_PAGE,
  createGitHubReleaseUpdateBackend,
} from './services/github-release-update-backend'
import { GlobalConfigUpdatePreferencesStore } from './services/update-preferences-store'
import {
  hasWindowsUpdateConfiguration,
  isMacUpdateReminderEnabled,
  isWindowsUpdateRuntimeEnabled,
} from './services/update-runtime'
import { startUpdateRuntime } from './services/update-startup'
import {
  claimReleaseVectorSmokeInvocation,
  releaseVectorSmokeWasRequested,
  runReleaseVectorSmoke,
} from './services/release-vector-smoke'
import {
  claimReleaseOfficialHomepageSmokeInvocation,
  releaseOfficialHomepageSmokeWasRequested,
  runReleaseOfficialHomepageSmoke,
} from './services/release-official-homepage-smoke'
import {
  claimReleaseSkinSmokeInvocation,
  releaseSkinSmokeWasRequested,
  runReleaseSkinSmoke,
} from './services/release-skin-smoke'
import { registerOfficialHomepageController } from './controllers/official-homepage-controller'
import type { UpdateState } from './services/update-service'
import {
  createOfficialHomepageWindowOpenHandler,
  preventRendererNavigation,
} from './services/official-homepage-navigation'
import { configureSingleInstanceRuntime } from './services/single-instance-runtime'
import { installWindowCloseGuard } from './controllers/window-controller'
import { shutdownManagedLocalEngines } from './services/managed-local'

import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Windows 发行版优先兼容旧显卡、远程桌面与虚拟机。
// 使用软件渲染而不是禁用 GPU / renderer 沙箱；必须在 app ready 前设置。
if (process.platform === 'win32') {
  app.disableHardwareAcceleration()
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 构建产物目录结构
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

// The installed-package vector qualification is deliberately opt-in and
// fail-closed. A command-line request without the matching environment token
// must never turn into a normal interactive application launch.
const releaseVectorSmokeRequested = releaseVectorSmokeWasRequested(process.argv)
const releaseHomepageSmokeRequested = releaseOfficialHomepageSmokeWasRequested(process.argv)
const releaseSkinSmokeRequested = releaseSkinSmokeWasRequested(process.argv)
const releaseSmokeRequested = releaseVectorSmokeRequested || releaseHomepageSmokeRequested || releaseSkinSmokeRequested
const releaseVectorSmokeInvocation = releaseVectorSmokeRequested
  ? claimReleaseVectorSmokeInvocation(process.argv, process.env)
  : undefined
const releaseHomepageSmokeInvocation = releaseHomepageSmokeRequested
  ? claimReleaseOfficialHomepageSmokeInvocation(process.argv, process.env)
  : undefined
const releaseSkinSmokeInvocation = releaseSkinSmokeRequested
  ? claimReleaseSkinSmokeInvocation(process.argv, process.env)
  : undefined
const moshuPackageSmokeRequested = moshuPackageSmokeWasRequested(process.argv)
const applicationInstanceAccepted = configureSingleInstanceRuntime({
  releaseSmokeRequested: releaseSmokeRequested || moshuPackageSmokeRequested,
  requestLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  onSecondInstance: listener => { app.on('second-instance', () => listener()) },
  getWindow: () => win,
})
let releaseSmokeStage = 'not-requested'
let releaseSmokeTimeout: NodeJS.Timeout | undefined

function reportReleaseSmokeStage(stage: string): void {
  if (!releaseSmokeRequested) return
  releaseSmokeStage = stage
  process.stderr.write(`[AI Novel release smoke] stage=${stage}\n`)
}

function clearReleaseSmokeTimeout(): void {
  if (releaseSmokeTimeout === undefined) return
  clearTimeout(releaseSmokeTimeout)
  releaseSmokeTimeout = undefined
}

if (releaseSmokeRequested) {
  reportReleaseSmokeStage('bootstrap')
  const timeoutDescription = releaseVectorSmokeRequested
    ? 'Packaged vector smoke timed out after 90 seconds'
    : releaseHomepageSmokeRequested
      ? 'Packaged official homepage smoke timed out after 90 seconds'
      : 'Packaged skin smoke timed out after 90 seconds'
  releaseSmokeTimeout = setTimeout(() => {
    console.error(`[AI Novel release smoke] ${timeoutDescription}; last stage=${releaseSmokeStage}`)
    app.exit(1)
  }, 90_000)
}

function publishUpdateState(state: UpdateState): void {
  for (const target of BrowserWindow.getAllWindows()) {
    if (target.isDestroyed() || target.webContents.isDestroyed()) continue
    target.webContents.send('update:state', state)
  }
}

function createWindow(show = true) {
  win = new BrowserWindow({
    show,
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: mainT(app.getLocale(), 'app.windowTitle'),
    icon: path.join(process.env.VITE_PUBLIC!, 'moshu-icon.png'),
    // 使用应用内自绘标题栏，避免 Windows 原生标题栏与棕色标题栏重复显示。
    frame: false,
    backgroundColor: '#F7F5EF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // 安全性设置
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  installWindowCloseGuard(win)

  if (process.platform === 'darwin') {
    app.dock?.setIcon(path.join(process.env.VITE_PUBLIC!, 'moshu-icon.png'))
  }

  // 隐藏默认菜单栏（Windows/Linux）
  win.setMenuBarVisibility(false)

  // 所有新窗口都留在应用外；仅精确匹配的官方仓库可交给系统浏览器。
  if (!show) {
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  }

  win.webContents.setWindowOpenHandler(createOfficialHomepageWindowOpenHandler({
    openExternal: url => shell.openExternal(url),
    onOpenExternalError: error => {
      console.warn('[AI Novel Writer] Unable to open official homepage from a window request.', error)
    },
  }))
  // 渲染进程不能把现有主窗口导航到外部内容。
  win.webContents.on('will-navigate', preventRendererNavigation)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function createReleaseHomepageSmokeWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
}

async function runPackagedOfficialHomepageSmoke(token: string) {
  return runReleaseOfficialHomepageSmoke(token, {
    createWindow: createReleaseHomepageSmokeWindow,
    loadProbeDocument: window => window.loadFile(path.join(RENDERER_DIST, 'release-homepage-smoke.html')),
    removeHandler: channel => ipcMain.removeHandler(channel),
    registerController: options => registerOfficialHomepageController(options),
  })
}

// macOS: 关闭所有窗口不退出
app.on('window-all-closed', () => {
  if (!applicationInstanceAccepted) return
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

// macOS: 点击 dock 图标重新创建窗口
app.on('activate', () => {
  if (!applicationInstanceAccepted || releaseSmokeRequested || moshuPackageSmokeRequested) return
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Stop only child processes created by this application, never an existing Ollama service.
let managedShutdownStarted = false
app.on('before-quit', event => {
  if (managedShutdownStarted) return
  event.preventDefault()
  managedShutdownStarted = true
  void shutdownManagedLocalEngines().catch(error => {
    console.warn('[Managed local engine] Shutdown failed:', error)
  }).finally(() => app.quit())
})

app.whenReady().then(async () => {
  if (!applicationInstanceAccepted) return
  reportReleaseSmokeStage('electron-ready')
  if (releaseSmokeRequested) {
    const requestedSmokeModeCount = Number(releaseVectorSmokeRequested)
      + Number(releaseHomepageSmokeRequested)
      + Number(releaseSkinSmokeRequested)
    const invocationCount = Number(releaseVectorSmokeInvocation !== undefined)
      + Number(releaseHomepageSmokeInvocation !== undefined)
      + Number(releaseSkinSmokeInvocation !== undefined)
    if (requestedSmokeModeCount !== 1 || invocationCount !== 1) {
      throw new Error('Invalid packaged smoke invocation: exactly one environment and one-time CLI token pair must match')
    }
    reportReleaseSmokeStage(
      releaseVectorSmokeInvocation
        ? 'vector-invocation-valid'
        : releaseHomepageSmokeInvocation
          ? 'official-homepage-invocation-valid'
          : 'skin-invocation-valid',
    )
    const evidence = releaseVectorSmokeInvocation
      ? await runReleaseVectorSmoke(releaseVectorSmokeInvocation.token)
      : releaseHomepageSmokeInvocation
        ? await runPackagedOfficialHomepageSmoke(releaseHomepageSmokeInvocation.token)
        : runReleaseSkinSmoke(releaseSkinSmokeInvocation!.token)
    reportReleaseSmokeStage('evidence-ready')
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
    clearReleaseSmokeTimeout()
    app.exit(0)
    return
  }

  const moshuSmoke = moshuPackageSmokeRequested
    ? claimMoshuPackageSmoke(process.argv, process.env, app.getPath('userData'))
    : undefined
  if (moshuSmoke) setTimeout(() => app.exit(1), 60_000).unref()

  // 先准备主进程服务和 IPC，再允许渲染层加载并发起调用。
  registerIPCHandlers()
  registerMCPHandlers()
  // 更新功能失败不能阻断作者进入应用；窗口先于更新运行时创建。
  createWindow(!moshuSmoke)
  const windowsUpdateEnabled = !MANUAL_DISTRIBUTION_UPDATES && isWindowsUpdateRuntimeEnabled(app.isPackaged, VITE_DEV_SERVER_URL)
  const macUpdateReminderEnabled = !MANUAL_DISTRIBUTION_UPDATES && isMacUpdateReminderEnabled(app.isPackaged, VITE_DEV_SERVER_URL)
  const updateRuntimeEnabled = windowsUpdateEnabled || macUpdateReminderEnabled
  const updateConfiguration = windowsUpdateEnabled && !hasWindowsUpdateConfiguration()
    ? 'missing'
    : 'available'
  startUpdateRuntime({
    updateRuntimeEnabled,
    updateConfiguration,
    currentVersion: app.getVersion(),
    updateAction: windowsUpdateEnabled ? 'download' : 'open-release',
    openRelease: () => shell.openExternal(GITHUB_LATEST_RELEASE_PAGE),
    createBackend: windowsUpdateEnabled
      ? createElectronUpdaterBackend
      : createGitHubReleaseUpdateBackend,
    createPreferences: () => new GlobalConfigUpdatePreferencesStore(),
    registerController: updateService => {
      registerUpdateController(updateService, { ipc: ipcMain, publish: publishUpdateState })
    },
    reportFailure: (operation, error) => {
      console.warn(`[Vela Update] ${operation}失败，已降级并继续启动应用。`, error)
    },
  })
  if (moshuSmoke && win) {
    const evidence = await verifyMoshuHiddenWindow(win)
    process.stdout.write(`${JSON.stringify({ ...evidence, applicationName: app.getName(), isolatedProfile: true })}\n`)
    app.exit(0)
  }
}).catch((error: unknown) => {
  clearReleaseSmokeTimeout()
  console.error('[Vela] Electron 启动失败。', error)
  if (releaseSmokeRequested || moshuPackageSmokeRequested) {
    app.exit(1)
    return
  }
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
