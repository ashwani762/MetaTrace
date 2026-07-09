<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    node: any;
    totalDur: number;
    depth: number;
}>();

const widthPercent = computed(() => {
    if (props.totalDur === 0) return 0;
    // Cap at 100% just in case
    return Math.min(100, Math.max(0, (props.node.dur / props.totalDur) * 100));
});

const hue = computed(() => {
    // Colors based on depth, or can be random. Depth-based is nice.
    return (props.depth * 45) % 360;
});

const bgColor = computed(() => {
    if (props.node.failed) return '#ef4444'; // Red for failed SFINAE
    return `hsl(${hue.value}, 60%, 35%)`;
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
    class="flex flex-col overflow-hidden" 
    :style="{ width: `${widthPercent}%`, minWidth: '1px' }"
  >
    <div 
      class="h-6 whitespace-nowrap overflow-hidden text-ellipsis px-1 text-xs text-white border-r border-b border-gray-900 cursor-pointer transition-colors"
      :style="{ backgroundColor: bgColor }"
      :title="`${node.name}\nTotal: ${(node.dur / 1000).toFixed(3)} ms`"
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
