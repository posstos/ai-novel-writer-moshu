import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import type { ManagedDevice } from '../../../src/shared/managed-local'

export async function allocateLoopbackPort(): Promise<number> {
  const server = net.createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Cannot allocate loopback port')); return }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

/** No inherited model directories, tokens, proxy settings, remote model URLs or executable search paths. */
export function isolatedEngineEnvironment(home: string, executable: string, device: ManagedDevice, parent: Record<string, string | undefined> = process.env): NodeJS.ProcessEnv {
  // The app augments ProcessEnv with renderer-only fields; child engines intentionally do not inherit them.
  const env = {} as NodeJS.ProcessEnv
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PATHEXT']) {
    if (parent[key]) env[key] = parent[key]
  }
  const system = parent.SystemRoot || 'C:\\Windows'
  env.PATH = [path.dirname(executable), path.join(system, 'System32'), system].join(path.delimiter)
  env.HOME = home; env.USERPROFILE = home
  env.APPDATA = path.join(home, 'AppData/Roaming'); env.LOCALAPPDATA = path.join(home, 'AppData/Local')
  env.TEMP = path.join(home, 'tmp'); env.TMP = env.TEMP
  for (const folder of [home, env.APPDATA, env.LOCALAPPDATA, env.TEMP]) fs.mkdirSync(folder, { recursive: true })
  env.OLLAMA_NO_CLOUD = '1'
  env.OLLAMA_NUM_PARALLEL = '1'
  env.OLLAMA_MAX_LOADED_MODELS = '1'
  env.OLLAMA_KEEP_ALIVE = '5m'
  if (device === 'cpu') {
    env.CUDA_VISIBLE_DEVICES = '-1'; env.HIP_VISIBLE_DEVICES = '-1'; env.ROCR_VISIBLE_DEVICES = '-1'
    env.GGML_VK_VISIBLE_DEVICES = '-1'; env.OLLAMA_VULKAN = '0'
  }
  return env
}

export function spawnOwnedEngine(executable: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(executable, args, { cwd: path.dirname(executable), env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
}

export async function stopOwnedEngine(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  // PID comes only from the retained ChildProcess handle; never stop by image name or port.
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe')
      const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' })
      killer.once('error', reject)
      killer.once('exit', code => (code === 0 || child.exitCode !== null || child.signalCode !== null) ? resolve() : reject(new Error('Could not stop the application-owned engine process')))
    })
  } else {
    child.kill('SIGTERM')
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Engine process did not exit')), 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}
