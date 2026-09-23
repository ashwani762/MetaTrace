<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, EdgeLabelRenderer } from '@vue-flow/core';

// A "reused from cache" edge: bows out to the right of the tree so it never hides a tree edge
const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  markerEnd?: string;
  style?: Record<string, any>;
  label?: string;
}>();

const geometry = computed(() => {
  const dy = Math.abs(props.targetY - props.sourceY);
  const bow = Math.min(220, 50 + dy * 0.3);
  const c1x = props.sourceX + bow;
  const c2x = props.targetX + bow;
  const path = `M ${props.sourceX} ${props.sourceY} C ${c1x} ${props.sourceY}, ${c2x} ${props.targetY}, ${props.targetX} ${props.targetY}`;
  // Midpoint of the cubic at t = 0.5
  const labelX = (props.sourceX + 3 * c1x + 3 * c2x + props.targetX) / 8;
  const labelY = (props.sourceY + props.targetY) / 2;
  return { path, labelX, labelY };
});
</script>

<template>
  <BaseEdge :id="id" :path="geometry.path" :marker-end="markerEnd" :style="style" />
  <EdgeLabelRenderer>
    <div
      v-if="label"
      class="reuse-label nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${geometry.labelX}px, ${geometry.labelY}px)`, opacity: style?.opacity ?? 1 }"
    >♻ {{ label }}</div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.reuse-label {
  position: absolute;
  pointer-events: none;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10px;
  color: #c4b5fd;
  background: #1e1b4b;
  border: 1px solid #4c1d95;
  border-radius: 4px;
  padding: 0 4px;
}
</style>
