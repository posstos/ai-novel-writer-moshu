/* Moshu manual Windows packaging: typecheck, focused tests, renderer build, vendor prep. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeLogged } from './lib/moshu-process.mjs'

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')).replace(/^([a-z]):/, (_, drive) => drive.toUpperCase() + ':')
const LOGS = path.join(ROOT, '.runtime/moshu-package/logs')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const summaryPath = path.join(ROOT, '.runtime/moshu-package/build-summary.json')
fs.mkdirSync(LOGS, { recursive: true })
fs.writeFileSync(summaryPath, JSON.stringify({ kind: 'moshu-build', status: 'running', version: VERSION }) + '\n')
process.on('exit', code => {
  if (code !== 0) fs.writeFileSync(summaryPath, JSON.stringify({ kind: 'moshu-build', status: 'failed', version: VERSION, exitCode: code }) + '\n')
})
const run = (name, args, timeout = 600_000) => executeLogged(process.execPath, args, { cwd: ROOT, log: path.join(LOGS, name + '.log'), timeout })

for (const file of [
  'public/moshu-icon.png', 'public/moshu-icon.svg', 'build/moshu.ico',
  'electron-builder.moshu.cjs', 'packaging/moshu-installer.nsh', 'packaging/Moshu-Safe-Mode.cmd',
  'docs/moshu-windows-release.md', 'docs/moshu-guide.md',
]) {
  if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`Missing required packaging input: ${file}`)
}

run('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit'])
run('lint-moshu', [
  'node_modules/eslint/bin/eslint.js',
  'electron/main.ts', 'electron/services/moshu-package-smoke.ts', 'src/shared/distribution.ts',
  'src/lib/offline-monaco.ts', 'src/components/updates/UpdateSection.tsx',
  '--report-unused-disable-directives', '--max-warnings', '0',
])
run('vitest-moshu', ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.moshu.config.ts'])
run('vitest-local-model', ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.local-model.config.ts'])
run('vitest-managed-local', ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.managed-local.config.ts'])
run('i18n', ['scripts/check-i18n-coverage.mjs'])

const { prepareMoshuVendor } = await import('./prepare-moshu-vendor.mjs')
const vendor = prepareMoshuVendor({ allowDownloads: process.argv.includes('--allow-tool-downloads') })
run('managed-engine-preparation', ['scripts/prepare-managed-engines.mjs', ...(process.argv.includes('--allow-runtime-downloads') ? ['--allow-runtime-downloads'] : [])], 3_600_000)
run('renderer', ['node_modules/vite/bin/vite.js', 'build'])
const { collectMoshuLicenses } = await import('./collect-moshu-licenses.mjs')
const licenses = collectMoshuLicenses(ROOT)

const summary = { kind: 'moshu-build', status: 'passed', version: VERSION, node: process.version, vendor, licenses }
fs.writeFileSync(path.join(ROOT, '.runtime/moshu-package/build-summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary))
