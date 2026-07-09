<script setup lang="ts">
import { computed, ref, provide } from 'vue';
import { treeData } from '../store';
import FlamegraphNode from './FlamegraphNode.vue';

const zoomedNode = ref<any | null>(null);

const setZoomedNode = (node: any | null) => {
  zoomedNode.value = node;
};

// Provide the zoom function to child FlamegraphNodes so they can call it on click
provide('setZoomedNode', setZoomedNode);

// When zoomed, the total time is the zoomed node's time. 
// When not zoomed, it's the sum of all roots.
const activeRoots = computed(() => {
  if (zoomedNode.value) {
    return [zoomedNode.value];
  }
  return treeData.value;
});

const totalCompileTime = computed(() => {
  if (zoomedNode.value) {
    return zoomedNode.value.dur || 0;
  }
  let total = 0;
  for (const root of treeData.value) {
    total += (root.dur || 0);
  }
  return total;
});
</script>

<template>
  <div class="h-full w-full bg-[#1e1e1e] p-2 overflow-auto text-gray-300 min-h-0 flex flex-col">
    <div v-if="treeData.length === 0" class="flex flex-1 items-center justify-center text-gray-500 italic text-sm">
      No trace data available. Run "Build & Trace" to generate a flamegraph.
    </div>
    <div v-else class="h-full flex flex-col font-mono relative">
      <div class="flex justify-between items-center mb-2 min-h-[24px]">
        <div class="text-xs text-gray-400">
          <span v-if="zoomedNode">Zoomed Time: {{(totalCompileTime / 1000).toFixed(3)}} ms</span>
          <span v-else>Total Instantiation Time: {{(totalCompileTime / 1000).toFixed(3)}} ms</span>
        </div>
        <button 
          v-if="zoomedNode" 
          @click="setZoomedNode(null)"
          class="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-white shadow transition-colors cursor-pointer"
        >
          Reset Zoom
        </button>
      </div>
      
      <!-- Graph Container -->
      <div class="flex-1 overflow-auto bg-[#1e1e1e] border border-gray-800 rounded">
        <div class="flex flex-row w-full min-w-max h-full">
          <FlamegraphNode 
            v-for="root in activeRoots" 
            :key="root.id" 
            :node="root" 
            :totalDur="totalCompileTime"
            :depth="0"
          />
        </div>
      </div>
    </div>
  </div>
</template>

