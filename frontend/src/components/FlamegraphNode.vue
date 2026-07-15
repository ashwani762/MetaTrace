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
    // Generate distinct hues based on string hash for consistent coloring across the spectrum
    const nameStr = props.node.name || '';
    let hash = 0;
    for (let i = 0; i < nameStr.length; i++) {
        hash = nameStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Avoid too much red/yellow (error/search colors)
    const rawHue = Math.abs(hash) % 360;
    return rawHue > 330 || rawHue < 40 ? rawHue + 60 : rawHue; 
});

const bgColor = computed(() => {
    if (isSearchMatch.value) return '#facc15'; // bright yellow for search matches
    if (props.node.failed) return '#ef4444'; // Solid Red for failed SFINAE
    // Vibrant but readable colors
    return `hsl(${hue.value}, 70%, 45%)`;
});

</script>

<template>
  <div 
    class="flex overflow-hidden"
    :class="isBottomUp ? 'flex-col-reverse justify-end' : 'flex-col'" 
    :style="{ width: `${widthPercent}%`, minWidth: '1px' }"
  >
    <div 
      class="h-7 whitespace-nowrap overflow-hidden text-ellipsis px-1.5 py-1 text-xs cursor-pointer transition-all duration-150 relative ring-1 ring-inset ring-gray-950/40"
      :class="[
        isSearchMatch ? 'text-black font-bold' : 'text-gray-100 font-medium',
        'hover:opacity-90 hover:z-10 hover:ring-2 hover:ring-white/50'
      ]"
      :style="{ backgroundColor: bgColor }"
      :title="`${node.name}\nTotal: ${(node.dur / 1000).toFixed(3)} ms`"
      @click="onClick"
    >
      {{ node.name }}
    </div>
    <div class="flex flex-row w-full h-full" v-if="node.children && node.children.length > 0">
      <FlamegraphNode 
        v-for="child in node.children" 
        :key="child.id" 
        :node="child" 
        :totalDur="node.dur" 
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
