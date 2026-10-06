import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    setupFiles: ['test/setup-locale.ts'],
    include: [
      'src/shared/__tests__/managed-local.test.ts',
      'electron/services/__tests__/managed-local.test.ts',
      'electron/llm/__tests__/managed-local-provider.test.ts',
      'src/components/settings/__tests__/managed-local-static.test.tsx',
    ],
  },
})
