import { loader } from '@monaco-editor/react'

// Use the installed package in development and bundled local files in Electron.
// Never depend on the loader's default public CDN for the comparison editor.
const vs = import.meta.env.DEV
  ? `${window.location.origin}/node_modules/monaco-editor/min/vs`
  : new URL('./monaco/vs', document.baseURI).href
loader.config({ paths: { vs } })
