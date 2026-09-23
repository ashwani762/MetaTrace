<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { ref } from 'vue';
import { compileOutput, prettyOutput, diagnostics, focusNode } from '../store';

const showRaw = ref(false);

const SEVERITY = {
  error: { icon: '✖', cls: 'border-red-700/60 bg-red-950/30 text-red-200' },
  warning: { icon: '▲', cls: 'border-amber-700/60 bg-amber-950/20 text-amber-100' },
  note: { icon: '•', cls: 'border-gray-700 text-gray-300' }
} as const;

const jumpTo = (line: number, col: number) => {
  window.dispatchEvent(new CustomEvent('editor-highlight', { detail: { line, col } }));
};
</script>

<template>
  <div class="h-full w-full bg-gray-900 text-gray-200 flex flex-col p-2 overflow-auto font-mono text-xs">
    <div v-if="!compileOutput" class="text-gray-500 italic flex items-center justify-center h-full text-sm">No output</div>

    <template v-else>
      <div class="flex items-center justify-between mb-2 text-gray-400">
        <span>
          <template v-if="diagnostics.length">
            {{ diagnostics.filter(d => d.severity === 'error').length }} error(s),
            {{ diagnostics.filter(d => d.severity === 'warning').length }} warning(s)
          </template>
          <template v-else>Compiler output</template>
        </span>
        <button v-if="diagnostics.length" class="hover:text-white" @click="showRaw = !showRaw">{{ showRaw ? 'Show parsed' : 'Show raw' }}</button>
      </div>

      <pre v-if="showRaw || diagnostics.length === 0" class="whitespace-pre-wrap text-gray-300">{{ prettyOutput }}</pre>

      <div v-else class="space-y-2">
        <div v-for="(d, i) in diagnostics" :key="i" class="rounded border px-2.5 py-1.5" :class="SEVERITY[d.severity].cls">
          <div class="flex gap-2">
            <span class="shrink-0" aria-hidden="true">{{ SEVERITY[d.severity].icon }}</span>
            <span class="font-semibold uppercase text-[10px] tracking-wider shrink-0 pt-px">{{ d.severity }}</span>
            <span class="break-words">{{ d.message }}</span>
            <button v-if="d.inMainFile" class="ml-auto shrink-0 text-blue-300 hover:underline" @click="jumpTo(d.line, d.col)">line {{ d.line }}</button>
          </div>
          <!-- Instantiation backtrace: the chain of templates that led to this error -->
          <ul v-if="d.notes.length" class="mt-1.5 ml-5 space-y-1 text-gray-400">
            <li v-for="(n, j) in d.notes" :key="j" class="flex gap-2">
              <span aria-hidden="true">↳</span>
              <span class="break-words">{{ n.message }}</span>
              <span class="ml-auto shrink-0 flex gap-2">
                <button v-if="n.nodeId" class="text-purple-300 hover:underline" @click="focusNode(n.nodeId)">graph</button>
                <button v-if="n.inMainFile" class="text-blue-300 hover:underline" @click="jumpTo(n.line, n.col)">line {{ n.line }}</button>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
