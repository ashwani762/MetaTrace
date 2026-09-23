<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';

// Header of a swimlane: the source line whose code triggered the instantiations below it
export interface LaneNodeData {
  line: number;
  source: string;
  count: number;
  failures: number;
}

const props = defineProps<{ id: string; data: LaneNodeData }>();

const jump = (e: MouseEvent) => {
  e.stopPropagation();
  if (props.data.line) window.dispatchEvent(new CustomEvent('editor-highlight', { detail: { line: props.data.line, col: 1 } }));
};
</script>

<template>
  <div class="lane-node" @click="jump" title="Click to show this line in the editor">
    <div class="flex items-center gap-2 text-[11px]">
      <span class="text-blue-300 font-semibold">{{ data.line ? `line ${data.line}` : 'implicit' }}</span>
      <span class="text-gray-500">{{ data.count }} instantiation{{ data.count === 1 ? '' : 's' }}</span>
      <span v-if="data.failures" class="text-red-300">✖ {{ data.failures }} discarded</span>
    </div>
    <code class="block mt-1 text-[11px] text-gray-200 truncate">{{ data.source || '—' }}</code>
    <Handle type="source" :position="Position.Bottom" class="lane-handle" />
  </div>
</template>

<style scoped>
.lane-node {
  width: 100%;
  height: 100%;
  padding: 6px 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  cursor: pointer;
  overflow: hidden;
}
.lane-handle {
  opacity: 0;
  pointer-events: none;
}
</style>
