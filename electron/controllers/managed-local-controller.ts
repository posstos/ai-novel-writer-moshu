import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getManagedLocalManager } from '../services/managed-local'
import { validateManagedSpec, type ManagedResult } from '../../src/shared/managed-local'

export function isTrustedManagedSender(event: IpcMainInvokeEvent): boolean {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) return false
  try {
    const actual = new URL(event.senderFrame.url)
    if (app.isPackaged || actual.protocol === 'file:') {
      if (actual.protocol !== 'file:') return false
      actual.search = ''; actual.hash = ''
      return path.resolve(fileURLToPath(actual)).toLowerCase() === path.resolve(app.getAppPath(), 'dist/index.html').toLowerCase()
    }
    const expected = new URL(process.env.VITE_DEV_SERVER_URL || 'about:blank')
    return ['http:', 'https:'].includes(actual.protocol) && actual.origin === expected.origin && ['/', '/index.html'].includes(actual.pathname)
  } catch { return false }
}

export function registerManagedLocalController() {
  const handle = <T>(name: string, action: (event: IpcMainInvokeEvent, value: unknown) => T | Promise<T>) => {
    ipcMain.handle(name, async (event, value): Promise<ManagedResult<T>> => {
      try {
        if (!isTrustedManagedSender(event)) throw new Error('Untrusted model-management caller')
        return { success: true, data: await action(event, value) }
      } catch (error) { return { success: false, error: String(error).slice(0, 1400) } }
    })
  }
  handle('managed-local:get-state', () => getManagedLocalManager().snapshot())
  handle('managed-local:import-gguf', async event => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('Model import requires an application window')
    const result = await dialog.showOpenDialog(owner, { title: 'Import GGUF / 导入完整 GGUF 模型', properties: ['openFile'], filters: [{ name: 'GGUF', extensions: ['gguf'] }] })
    if (result.canceled || result.filePaths.length !== 1) return null
    // No renderer-supplied path is accepted. Permission comes from this native picker.
    return getManagedLocalManager().importSelectedFile(result.filePaths[0])
  })
  handle('managed-local:activate', (_event, value) => getManagedLocalManager().activate(validateManagedSpec(value)))
  handle('managed-local:stop', async () => { await getManagedLocalManager().stop(); return getManagedLocalManager().snapshot() })
  handle('managed-local:forget', async (_event, value) => {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid imported model ID')
    await getManagedLocalManager().forget(value)
    return getManagedLocalManager().snapshot()
  })
  handle('managed-local:open-download', async () => {
    const source = getManagedLocalManager().downloadSource()
    if (!source.configured) throw new Error('The publisher has not configured the Quark share link yet')
    await shell.openExternal(source.url)
    return { opened: true }
  })
}
