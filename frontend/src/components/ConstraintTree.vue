<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
// Renders a normalized constraint tree: "all of" / "any of" groups, concept-ids expanded into
// their definitions, and atomic constraints, each marked satisfied, failed or not evaluated.
defineOptions({ name: 'ConstraintTree' });

export interface ConstraintNode {
  kind: 'and' | 'or' | 'concept' | 'atom';
  text: string;
  result: 'true' | 'false' | 'skipped';
  line?: number;
  declLine?: number;
  note?: string;
  children?: ConstraintNode[];
}

defineProps<{ node: ConstraintNode; depth?: number }>();

const STATUS = {
  true: { icon: '✔', cls: 'text-emerald-300', title: 'Satisfied' },
  false: { icon: '✖', cls: 'text-red-300', title: 'Not satisfied' },
  skipped: { icon: '·', cls: 'text-gray-500', title: 'Not evaluated (short-circuit)' }
} as const;

const jump = (line?: number) => {
  if (line) window.dispatchEvent(new CustomEvent('editor-highlight', { detail: { line, col: 1 } }));
};
</script>

<template>
  <div class="font-mono text-[11px] leading-relaxed">
    <div class="flex items-start gap-1.5" :class="node.result === 'skipped' ? 'opacity-60' : ''">
      <span class="w-3 shrink-0 text-center" :class="STATUS[node.result].cls" :title="STATUS[node.result].title">{{ STATUS[node.result].icon }}</span>
      <span v-if="node.kind === 'and' || node.kind === 'or'" class="text-gray-400 italic">
        {{ node.kind === 'and' ? 'all of' : 'any of' }}
      </span>
      <span v-else class="break-all" :class="node.kind === 'concept' ? 'text-cyan-300' : 'text-gray-200'">
        <span v-if="node.kind === 'concept'" class="text-[9px] uppercase tracking-wider text-cyan-500 mr-1">concept</span>{{ node.text }}
      </span>
      <button v-if="node.declLine || node.line" class="ml-auto shrink-0 text-gray-500 hover:text-blue-300" @click="jump(node.declLine || node.line)">
        L{{ node.declLine || node.line }}
      </button>
    </div>
    <div v-if="node.note" class="ml-5 text-red-200/80 break-words">{{ node.note }}</div>
    <div v-if="node.children?.length" class="ml-1.5 pl-3 border-l border-gray-700/70">
      <ConstraintTree v-for="(c, i) in node.children" :key="i" :node="c" :depth="(depth ?? 0) + 1" />
    </div>
  </div>
</template>
