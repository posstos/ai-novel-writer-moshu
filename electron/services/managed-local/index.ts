import { app } from 'electron'
import path from 'node:path'
import { VELA_HOME } from '../../utils/config-utils'
import { ManagedLocalManager } from './manager'

let manager: ManagedLocalManager | undefined
/** Lazy: merely importing the LLM provider must not start engines or read model files. */
export function getManagedLocalManager(): ManagedLocalManager {
  if (!manager) {
    const projectRoot = app.getAppPath()
    manager = new ManagedLocalManager({
      home: path.join(VELA_HOME, 'managed-local'),
      engines: app.isPackaged ? path.join(process.resourcesPath, 'engines') : path.join(projectRoot, '.runtime/managed-engines/payload'),
      downloadFiles: app.isPackaged
        ? [path.join(path.dirname(process.execPath), 'model-download.json'), path.join(process.resourcesPath, 'model-download.json')]
        : [path.join(projectRoot, 'packaging/model-download.json')],
    })
  }
  return manager
}
export async function shutdownManagedLocalEngines() { if (manager) await manager.stop(true) }
