// Copyright (c) 2024 MetaTrace Contributors
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
})
