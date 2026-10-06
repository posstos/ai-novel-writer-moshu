import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MANUAL_DISTRIBUTION_UPDATES } from '../distribution'

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('Moshu manual Windows distribution', () => {
  it('disables upstream auto-update without removing the update UI code', () => {
    expect(MANUAL_DISTRIBUTION_UPDATES).toBe(true)
    const main = source('electron/main.ts')
    expect(main).toContain('!MANUAL_DISTRIBUTION_UPDATES && isWindowsUpdateRuntimeEnabled')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain('contextIsolation: true')
    expect(main).not.toContain('app.setName(')
    expect(main).not.toMatch(/app\.setPath\(\s*['"]userData/)
    expect(source('src/components/updates/UpdateSection.tsx')).toContain('MANUAL_DISTRIBUTION_UPDATES')
  })

  it('keeps the historical installer identity and userData compatibility', () => {
    const config = source('electron-builder.moshu.cjs')
    expect(config).toContain("appId: 'com.ai-novel-writer.app'")
    expect(config).toContain("productName: '墨墅'")
    expect(config).toContain("executableName: 'Moshu'")
    expect(config).toContain("name: 'ai-novel-writer'")
    expect(config).toContain('npmRebuild: false')
    expect(config).toContain('publish: null')
    expect(config).toContain('perMachine: false')
    expect(config).toContain('deleteAppDataOnUninstall: false')
    expect(config).toContain('allowToChangeInstallationDirectory: true')
    expect(source('package.json')).toContain('"name": "ai-novel-writer"')
  })

  it('does not ship developer fixtures, sources or secrets in the packaged app', () => {
    const config = source('electron-builder.moshu.cjs')
    expect(config).toContain("'!**/.env*'")
    expect(config).toContain("'!dist-electron/release-vector-smoke.cjs'")
    expect(config).not.toContain("'src/**'")
    const offline = source('src/lib/offline-monaco.ts')
    expect(offline).toContain("./monaco/vs")
    expect(offline).not.toMatch(/jsdelivr|unpkg|cdn\./i)
  })

  it('requires Windows 10 or newer and keeps the safe-mode launcher side-effect free', () => {
    expect(source('packaging/moshu-installer.nsh')).toContain('AtLeastWin10')
    const safeMode = source('packaging/Moshu-Safe-Mode.cmd')
    expect(safeMode).toContain('Moshu.exe')
    expect(safeMode).toContain('--disable-gpu')
    expect(safeMode).not.toMatch(/reg add|regedit|sc config|taskkill|del \/[sq]/i)
  })

  it('gates the VC runtime download and never silently accepts changed bytes', () => {
    const vendor = source('scripts/prepare-moshu-vendor.mjs')
    expect(vendor).toContain('REDIST_SHA256')
    expect(vendor).toContain('RUNTIME_SHA256')
    expect(vendor).toContain('allowDownloads')
    expect(vendor).toContain('Re-review its version, signature and checksum')
    expect(vendor).toContain('extractionOnly: true')
    expect(vendor).toContain('systemInstallationPerformed: false')
  })

  it('runs hidden qualification only against isolated, token-verified temporary profiles', () => {
    const smoke = source('electron/services/moshu-package-smoke.ts')
    expect(smoke).toContain("startsWith('file:')")
    expect(smoke).toContain('typeof require')
    expect(smoke).not.toMatch(/\.vela['"]|homedir\(\)/)
    const main = source('electron/main.ts')
    expect(main).toContain("urls: ['http://*/*', 'https://*/*']")
    const process = source('scripts/lib/moshu-process.mjs')
    expect(process).toContain('AI_NOVEL_VELA_HOME')
    expect(process).not.toMatch(/homedir\(\)/)
  })

  it('preserves previous releases and includes the lint configuration in corresponding source', () => {
    const packaging = source('scripts/package-moshu.mjs')
    expect(packaging).toContain('--release-suffix=')
    expect(packaging).toContain('Refusing to overwrite an existing release')
    expect(packaging).toContain("'.eslintrc.cjs'")
    expect(source('electron-builder.moshu.cjs')).toContain('process.env.MOSHU_RELEASE_OUTPUT')
    expect(source('electron-builder.moshu.cjs')).toContain('win: { publish: null')
  })

  it('documents multi-PC usage honestly', () => {
    const guide = source('docs/moshu-windows-release.md')
    expect(guide).toContain('Windows 10 / 11')
    expect(guide).toContain('完整解压')
    expect(guide).toContain('不能只复制 EXE')
    expect(guide).toContain('手动更新')
    expect(guide).toContain('不包含模型')
    expect(existsSync(resolve(process.cwd(), 'docs/moshu-guide.md'))).toBe(true)
  })
})
