import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { setupFiles: ['test/setup-locale.ts'], include: [
    'electron/__tests__/main-window-contract.test.ts',
    'src/__tests__/theme-text-contrast.test.ts', 'src/__tests__/app-skin-background.test.tsx',
    'src/stores/__tests__/theme-store.test.ts', 'src/stores/__tests__/skin-store.test.ts',
    'src/shared/__tests__/brand.test.ts', 'src/components/layout/__tests__/*.test.*',
    'src/components/settings/__tests__/settings-branding.test.ts',
    'src/components/settings/__tests__/settings-appearance-navigation.test.ts',
    'src/components/__tests__/deletion-affordances.test.ts',
    'src/components/__tests__/project-session-gate.test.ts',
    'src/shared/__tests__/moshu-ui.test.ts',
    'src/shared/__tests__/moshu-distribution.test.ts',
  ] },
})
