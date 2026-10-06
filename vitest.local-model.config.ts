import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** Focused local-model regressions without starting Electron or rebuilding native bindings. */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  test: {
    setupFiles: ['test/setup-locale.ts'],
    include: [
      'src/shared/__tests__/local-model-profile.test.ts',
      'src/shared/__tests__/model-profile-draft.test.ts',
      'src/shared/__tests__/provider-presets.test.ts',
      'src/shared/__tests__/human-confirmed-review.test.ts',
      'src/services/generation/__tests__/generation-harness.test.ts',
      'src/services/generation/__tests__/generation-runtime-renderer.test.ts',
      'src/services/generation/__tests__/generation-runtime.test.ts',
      'src/services/generation/__tests__/prompt-budget-failure.test.ts',
      'src/services/workflows/commands/__tests__/refine-draft.command.test.ts',
      'src/services/workflows/__tests__/repair-finalize-workflow.test.ts',
      'src/stores/__tests__/workflow-store-generation-budget.test.ts',
      'src/services/__tests__/finalization-snapshot.test.ts',
      'src/components/settings/__tests__/model-settings-contract.test.ts',
      'electron/llm/__tests__/openai-provider.test.ts',
      'electron/llm/__tests__/local-openai-compatibility.test.ts',
      'electron/services/__tests__/model-discovery-service.test.ts',
      'electron/__tests__/embedding-options.test.ts',
      'electron/__tests__/embedding-batch-contract.test.ts',
      'scripts/__tests__/readme-localization.test.ts',
    ],
  },
})
