<script setup lang="ts">
import { computed } from 'vue';
import { treeData } from '../store';
import FlamegraphNode from './FlamegraphNode.vue';

const totalCompileTime = computed(() => {
  let total = 0;
  for (const root of treeData.value) {
    total += (root.dur || 0);
  }
  return total;
});
</script>

<template>
  <div class="h-full w-full bg-[#1e1e1e] p-2 overflow-auto text-gray-300 min-h-0">
    <div v-if="treeData.length === 0" class="flex items-center justify-center h-full text-gray-500 italic text-sm">
      No trace data available. Run "Build & Trace" to generate a flamegraph.
    </div>
    <div v-else class="h-full flex flex-col font-mono">
      <div class="mb-2 text-xs text-gray-400">Total Instantiation Time: {{(totalCompileTime / 1000).toFixed(3)}} ms</div>
      
      <!-- Graph Container -->
      <div class="flex-1 overflow-auto bg-[#1e1e1e] border border-gray-800 rounded">
        <div class="flex flex-row w-full min-w-max h-full">
          <FlamegraphNode 
            v-for="root in treeData" 
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
