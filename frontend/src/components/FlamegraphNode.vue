<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { computed, inject } from 'vue';
import type { Ref } from 'vue';

const props = defineProps<{
    node: any;
    totalDur: number;
    depth: number;
}>();

const setZoomedNode = inject('setZoomedNode') as ((node: any) => void) | undefined;
const isBottomUp = inject('isBottomUp') as Ref<boolean>;
const searchQuery = inject('searchQuery') as Ref<string>;

const isSearchMatch = computed(() => {
    if (!searchQuery?.value) return false;
    return props.node.name?.toLowerCase().includes(searchQuery.value.toLowerCase());
});

const onClick = (e: MouseEvent) => {
    e.stopPropagation(); // don't zoom out or up to parent
    if (setZoomedNode) {
        setZoomedNode(props.node);
    }
};

const widthPercent = computed(() => {
    if (props.totalDur === 0) return 0;
    // Cap at 100% just in case
    return Math.min(100, Math.max(0, (props.node.dur / props.totalDur) * 100));
});

const hue = computed(() => {
    // VTune style warm colors: yellow to orange-red.
    // Vary hue between 10 (red-orange) and 50 (yellow) based on string hash for consistent coloring.
    const nameStr = props.node.name || '';
    let hash = 0;
    for (let i = 0; i < nameStr.length; i++) {
        hash = nameStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    return 10 + (Math.abs(hash) % 40);
});

const bgColor = computed(() => {
    if (props.node.failed) return '#ef4444'; // Solid Red for failed SFINAE
    // Warm colors typical of VTune
    return `hsl(${hue.value}, 85%, 45%)`;
});

// Calculate how much time in this node was NOT spent in its children (self time)
const unrecordedDur = computed(() => {
    let childrenDur = 0;
    for (const child of (props.node.children || [])) {
        childrenDur += (child.dur || 0);
    }
    const rem = props.node.dur - childrenDur;
    return rem > 0 ? rem : 0;
});

const unrecordedPercent = computed(() => {
    if (props.node.dur === 0) return 0;
    return Math.min(100, Math.max(0, (unrecordedDur.value / props.node.dur) * 100));
});

</script>

<template>
  <div 
    class="flex overflow-hidden"
    :class="isBottomUp ? 'flex-col-reverse justify-end' : 'flex-col'" 
    :style="{ width: `${widthPercent}%`, minWidth: '1px' }"
  >
    <div 
      class="h-6 whitespace-nowrap overflow-hidden text-ellipsis px-1 text-xs text-white border-r border-[#1e1e1e] cursor-pointer transition-colors"
      :class="{
        'border-b': !isBottomUp,
        'border-t': isBottomUp,
        'ring-2 ring-yellow-400 ring-inset z-10': isSearchMatch
      }"
      :style="{ backgroundColor: bgColor }"
      :title="`${node.name}\nTotal: ${(node.dur / 1000).toFixed(3)} ms`"
      @click="onClick"
      onmouseover="this.style.filter='brightness(1.2)'"
      onmouseout="this.style.filter='brightness(1)'"
    >
      {{ node.name }}
    </div>
    <div class="flex flex-row w-full h-full" v-if="(node.children && node.children.length > 0) || unrecordedDur > 0">
      <FlamegraphNode 
        v-for="child in node.children" 
        :key="child.id" 
        :node="child" 
        :totalDur="node.dur" 
        :depth="depth + 1"
      />
      <!-- Render the empty remaining space if children don't take up 100% -->
      <div v-if="unrecordedPercent > 0" :style="{ width: `${unrecordedPercent}%` }" class="h-full border-r border-gray-900 bg-gray-800/20" title="Self Time"></div>
    </div>
  </div>
</template>
