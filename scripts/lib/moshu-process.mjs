import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export function executeLogged(executable, args, { cwd, env = process.env, log, timeout = 600_000 }) {
  const result = spawnSync(executable, args, { cwd, env, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 24 * 1024 * 1024 })
  fs.mkdirSync(path.dirname(log), { recursive: true })
  fs.writeFileSync(log, `${result.stdout || ''}\n${result.stderr || ''}\nEXIT_CODE=${result.status}\n${result.error ? String(result.error) : ''}\n`)
  if (result.error || result.status !== 0) throw new Error(`${path.basename(log)} failed (exit=${result.status}); see ${log}`)
  return String(result.stdout || '')
}

export function isolatedEnvironment(root, token) {
  const env = { ...process.env }
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR', 'VITE_DEV_SERVER_URL', 'AI_NOVEL_RELEASE_GATE', 'AI_NOVEL_RELEASE_SMOKE', 'AI_NOVEL_RELEASE_SMOKE_TOKEN', 'AI_NOVEL_RELEASE_HOMEPAGE_SMOKE', 'AI_NOVEL_RELEASE_SKIN_SMOKE', 'MOSHU_PACKAGE_SMOKE_TOKEN', 'MOSHU_PACKAGE_SMOKE_ROOT']) delete env[name]
  env.PATH = [process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(path.delimiter)
  // Windows environment keys are case-insensitive; remove differently-cased duplicates.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path' && key !== 'PATH') delete env[key]
  env.AI_NOVEL_VELA_HOME = path.join(root, 'home')
  env.MOSHU_PACKAGE_SMOKE_TOKEN = token
  env.MOSHU_PACKAGE_SMOKE_ROOT = root
  fs.mkdirSync(env.AI_NOVEL_VELA_HOME, { recursive: true })
  fs.mkdirSync(path.join(root, 'user-data'), { recursive: true })
  fs.writeFileSync(path.join(root, '.moshu-test-owner'), token)
  fs.writeFileSync(path.join(root, 'home/config.json'), JSON.stringify({ locale: 'zh-CN', recentProjects: [] }) + '\n')
  return env
}
