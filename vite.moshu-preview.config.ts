import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
export default defineConfig({
  plugins: [tailwindcss(), react(), { name: 'preview-only-entry', transformIndexHtml(html) { return html.replace('/src/main.tsx', '/test/moshu-preview.tsx') } }],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
})
