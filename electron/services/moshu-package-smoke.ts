import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'

const PREFIX = '--moshu-package-smoke='
export interface MoshuPackageSmokeInvocation { root: string }

export function moshuPackageSmokeWasRequested(args: readonly string[]): boolean {
  return args.some(arg => arg.startsWith(PREFIX))
}

/** Never expose this qualification mode through IPC. A token alone is not sufficient. */
export function claimMoshuPackageSmoke(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  userDataPath: string,
): MoshuPackageSmokeInvocation {
  const flags = args.filter(arg => arg.startsWith(PREFIX))
  const token = flags[0]?.slice(PREFIX.length)
  if (flags.length !== 1 || !token || !/^[a-f0-9]{48}$/.test(token) || env.MOSHU_PACKAGE_SMOKE_TOKEN !== token) {
    throw new Error('Invalid Moshu qualification token')
  }
  const root = fs.realpathSync.native(env.MOSHU_PACKAGE_SMOKE_ROOT ?? '')
  const temp = fs.realpathSync.native(os.tmpdir())
  if (path.dirname(root).toLowerCase() !== temp.toLowerCase() || !/^moshu-package-check-[a-zA-Z0-9_-]+$/.test(path.basename(root))) {
    throw new Error('Qualification requires a newly created temporary directory')
  }
  const equalsPath = (a: string | undefined, b: string) => !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  if (!equalsPath(env.AI_NOVEL_VELA_HOME, path.join(root, 'home')) || !equalsPath(userDataPath, path.join(root, 'user-data'))) {
    throw new Error('Qualification refused a non-isolated application profile')
  }
  if (fs.readFileSync(path.join(root, '.moshu-test-owner'), 'utf8') !== token) {
    throw new Error('Qualification directory ownership marker does not match')
  }
  return { root }
}

/** Run the real bundled renderer, preload and IPC with no visible window and no user data. */
export async function verifyMoshuHiddenWindow(window: BrowserWindow) {
  if (window.isVisible()) throw new Error('The qualification window must remain hidden')
  const deadline = Date.now() + 35_000
  while (window.webContents.isLoadingMainFrame() || !window.webContents.getURL().startsWith('file:')) {
    if (Date.now() >= deadline) throw new Error('Packaged renderer did not load from a local file')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const evidence = await window.webContents.executeJavaScript(`(async () => {
    const until = Date.now() + 25000;
    while (!document.querySelector('.moshu-hero') || !window.velaAPI) {
      if (Date.now() > until) throw new Error('Moshu home did not become ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await document.fonts.ready;
    const modelState = await window.velaAPI.invoke('llm:list-models');
    const updates = await window.velaAPI.invoke('update:get-state');
    const help = document.querySelector('.moshu-home-heading .moshu-text-button');
    if (!help) throw new Error('Missing guide entry');
    help.click();
    const guideDeadline = Date.now() + 3000;
    while (!document.querySelector('.moshu-guide-content')) {
      if (Date.now() > guideDeadline) throw new Error('Guide failed to open');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const guideReady = !!document.querySelector('.moshu-guide-content');
    const next = Array.from(document.querySelectorAll('.moshu-guide-content button')).find(b => b.textContent.includes('下一步'));
    if (!next) throw new Error('Guide next-step button is missing');
    next.click();
    const settingsDeadline = Date.now() + 10000;
    let settingsButton;
    while (!(settingsButton = Array.from(document.querySelectorAll('.moshu-guide-content button')).find(b => b.textContent.includes('去配置模型')))) {
      if (Date.now() > settingsDeadline) throw new Error('Guide model-settings entry is missing');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    settingsButton.click();
    while (!document.querySelector('[aria-label="内置本地模型"]')) {
      if (Date.now() > settingsDeadline) throw new Error('Embedded model panel did not render');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const managed = await window.velaAPI.invoke('managed-local:get-state');
    if (!managed.success || managed.data.models.length !== 0 || managed.data.status !== 'stopped' || !managed.data.engines.every(e => e.available)) throw new Error('Embedded engine IPC / isolation check failed');
    const quark = Array.from(document.querySelectorAll('[aria-label="内置本地模型"] button')).find(b => b.textContent.includes('夸克'));
    if (!managed.data.download.configured || !managed.data.download.url || !quark || quark.disabled) throw new Error('Configured Quark share link must enable the model-download button');
    if (typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('Node globals leaked into the packaged renderer')
    return {
      title: document.title,
      nodeGlobalsAbsent: true,
      fileOrigin: location.protocol === 'file:',
      bridgeReady: typeof window.velaAPI.invoke === 'function',
      heroReady: !!document.querySelector('.moshu-hero'),
      guideReady,
      embeddedModelPanelReady: true,
      embeddedEnginesAvailable: managed.data.engines,
      quarkShareConfigured: managed.data.download.configured,
      quarkShareButtonEnabled: !quark.disabled,
      fontsReady: document.fonts.status === 'loaded',
      updatesDisabled: updates.status === 'disabled',
      noConfiguredModels: Array.isArray(modelState) && modelState.length === 0,
      developerFixtureAbsent: window.moshuPreview === undefined
    };
  })()`)
  if (!evidence.fileOrigin || !evidence.bridgeReady || !evidence.heroReady || !evidence.guideReady || !evidence.fontsReady || !evidence.updatesDisabled || !evidence.noConfiguredModels || !evidence.developerFixtureAbsent || !evidence.quarkShareConfigured || !evidence.quarkShareButtonEnabled) {
    throw new Error('Packaged UI qualification returned incomplete evidence')
  }
  return { kind: 'moshu-hidden-ui', ...evidence, windowVisible: false }
}
