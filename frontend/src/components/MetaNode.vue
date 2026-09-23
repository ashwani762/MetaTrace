<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { toggleCollapse, toggleChain } from '../store';

export interface MetaNodeData {
  label: string;        // Plain one-line label (used for PNG export and search)
  base: string;
  args: string[];
  phase: string;        // e.g. "instantiate", "deduce", "concept check"
  phaseGroup: 'instantiate' | 'deduce' | 'concept' | 'alias' | 'base' | 'other';
  result?: string;
  reason?: string;
  failKind?: string;
  reuse?: number;
  line?: number;
  childCount: number;
  hiddenCount: number;  // Descendants hidden because this node is collapsed
  collapsed: boolean;
  chain?: { levels: number; steps: string[] };  // Folded recursion: argument list of each level
}

const props = defineProps<{ id: string; data: MetaNodeData }>();

const MAX_ARGS = 4;

const jumpToLine = (e: MouseEvent) => {
  e.stopPropagation();
  if (props.data.line) window.dispatchEvent(new CustomEvent('editor-highlight', { detail: { line: props.data.line, col: 1 } }));
};

const onExpandChain = (e: MouseEvent) => {
  e.stopPropagation();
  toggleChain(props.id);
};

/** First two and last two levels, e.g. <12> → <11> → … → <3> → <2> */
const chainPreview = (steps: string[]) =>
  steps.length <= 5 ? steps : [...steps.slice(0, 2), '…', ...steps.slice(-2)];

const onToggle = (e: MouseEvent) => {
  e.stopPropagation();
  toggleCollapse(props.id);
};
</script>

<template>
  <div class="meta-node">
    <Handle type="target" :position="Position.Top" class="meta-handle" />

    <div class="flex items-center gap-1.5 min-w-0">
      <span class="phase-chip" :class="`phase-${data.phaseGroup}`">{{ data.phase }}</span>
      <span class="font-semibold text-[12px] text-white truncate" :title="data.label">{{ data.base }}</span>
      <button v-if="data.line" class="ml-auto shrink-0 text-[10px] text-gray-400 hover:text-blue-300" title="Show the line that triggered this" @click="jumpToLine">L{{ data.line }}</button>
      <button
        v-if="data.childCount > 0"
        class="shrink-0 w-4 text-[10px] text-gray-400 hover:text-white"
        :class="{ 'ml-auto': !data.line }"
        :title="data.collapsed ? 'Expand subtree' : 'Collapse subtree'"
        @click="onToggle"
      >{{ data.collapsed ? '▸' : '▾' }}</button>
    </div>

    <div v-if="data.args.length" class="flex flex-wrap gap-1 mt-1.5">
      <span v-for="(a, i) in data.args.slice(0, MAX_ARGS)" :key="i" class="arg-chip" :title="a">{{ a }}</span>
      <span v-if="data.args.length > MAX_ARGS" class="arg-chip text-gray-400">+{{ data.args.length - MAX_ARGS }}</span>
    </div>

    <!-- Folded recursion chain -->
    <div v-if="data.chain" class="chain-row" :title="data.chain.steps.map(s => '<' + s + '>').join(' → ')">
      <span class="text-amber-300 shrink-0">↻ {{ data.chain.levels }} levels</span>
      <span class="truncate text-gray-300">
        <template v-for="(st, i) in chainPreview(data.chain.steps)" :key="i">
          <span v-if="i > 0" class="text-gray-600"> → </span>
          <span>{{ st === '…' ? '…' : '‹' + st + '›' }}</span>
        </template>
      </span>
      <button class="ml-auto shrink-0 text-[10px] text-amber-300 hover:text-white" title="Show every level (double-click the card)" @click="onExpandChain">expand</button>
    </div>

    <div v-if="data.result || data.reuse || data.collapsed" class="flex items-center gap-2 mt-1.5 text-[11px]">
      <span v-if="data.result" class="text-emerald-300 truncate" :title="data.result">⇒ {{ data.result }}</span>
      <span v-if="data.reuse" class="text-violet-300 shrink-0" title="Later requests reused this specialization from the cache instead of instantiating it again">♻ reused {{ data.reuse }}×</span>
      <span v-if="data.collapsed" class="ml-auto text-gray-400 shrink-0">+{{ data.hiddenCount }} hidden</span>
    </div>

    <div v-if="data.reason" class="reason" :title="data.reason">
      {{ data.failKind === 'constraints' ? '⊘' : '✖' }} {{ data.reason }}
    </div>

    <Handle type="source" :position="Position.Bottom" class="meta-handle" />
    <!-- Side handles so "reused" edges arc beside the tree instead of overlapping it -->
    <Handle id="reuse-out" type="source" :position="Position.Right" class="meta-handle" />
    <Handle id="reuse-in" type="target" :position="Position.Right" class="meta-handle" />
  </div>
</template>

<style scoped>
.meta-node {
  width: 100%;
  height: 100%;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  text-align: left;
  overflow: hidden;
}
.meta-handle {
  opacity: 0;
  pointer-events: none;
}
.phase-chip {
  flex-shrink: 0;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid currentColor;
}
.phase-instantiate { color: #93c5fd; }
.phase-deduce { color: #c4b5fd; }
.phase-concept { color: #67e8f9; }
.phase-alias { color: #fdba74; }
.phase-base { color: #6ee7b7; }
.phase-other { color: #9ca3af; }
.arg-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 0 5px;
}
.chain-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.25);
  min-width: 0;
}
.reason {
  margin-top: 6px;
  font-size: 10px;
  line-height: 1.35;
  color: #fecaca;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
