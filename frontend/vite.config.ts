// Copyright (c) 2026 MetaTrace Contributors
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    (monacoEditorPlugin as any).default({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'html']
    })
  ],
  server: {
    // Forward API and LSP traffic to the backend (see README: BACKEND_PORT must match its PORT)
    proxy: {
      '/api': `http://localhost:${process.env.BACKEND_PORT || 80}`,
      '/lsp': { target: `ws://localhost:${process.env.BACKEND_PORT || 80}`, ws: true }
    }
  },
})
