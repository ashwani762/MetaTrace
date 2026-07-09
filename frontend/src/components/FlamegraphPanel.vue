<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { computed, ref, provide } from 'vue';
import { treeData } from '../store';
import FlamegraphNode from './FlamegraphNode.vue';

const zoomedNode = ref<any | null>(null);
const isBottomUp = ref(false);
const searchQuery = ref('');

const setZoomedNode = (node: any | null) => {
  zoomedNode.value = node;
};

// Provide state and functions to child FlamegraphNodes
provide('setZoomedNode', setZoomedNode);
provide('isBottomUp', isBottomUp);
provide('searchQuery', searchQuery);

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
      <!-- Toolbar -->
      <div class="flex justify-between items-center mb-2 bg-[#252526] p-1 rounded border border-gray-700">
        <div class="text-xs text-gray-400 pl-2">
          <span v-if="zoomedNode">Zoomed: {{(totalCompileTime / 1000).toFixed(3)}} ms</span>
          <span v-else>Total: {{(totalCompileTime / 1000).toFixed(3)}} ms</span>
        </div>
        
        <div class="flex items-center space-x-2 pr-1">
          <input 
            v-model="searchQuery" 
            type="text" 
            placeholder="Search..." 
            class="bg-gray-800 text-white text-xs px-2 py-1 border border-gray-600 rounded focus:outline-none focus:border-blue-500 w-48"
          />
          
          <button 
            @click="isBottomUp = !isBottomUp"
            class="p-1 hover:bg-gray-700 rounded text-gray-300 transition-colors"
            :title="isBottomUp ? 'Switch to Top-Down (Icicle)' : 'Switch to Bottom-Up (Flame)'"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
            </svg>
          </button>

          <button 
            v-if="zoomedNode"
            @click="setZoomedNode(null)"
            class="p-1 hover:bg-gray-700 rounded text-blue-400 transition-colors"
            title="Reset Zoom"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
            </svg>
          </button>
        </div>
      </div>
      
      <!-- Graph Container -->
      <div class="flex-1 overflow-auto bg-[#1e1e1e] border border-gray-800 rounded relative">
        <div 
          class="flex flex-row w-full min-w-max min-h-full absolute inset-0"
          :class="isBottomUp ? 'items-end' : 'items-start'"
        >
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

