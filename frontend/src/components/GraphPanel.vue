<script setup lang="ts">
import Graph from './Graph.vue';
import { computed } from 'vue';
import { 
  traceSteps, 
  currentStepIndex, 
  logicalStepIndex,
  treeData,
  logicalMaxSteps,
  setStepIndex,
  handleStep
} from '../store';

const progress = computed({
  get: () => logicalStepIndex.value,
  set: (val: number) => setStepIndex(val)
});
</script>

<template>
  <div class="h-full w-full flex flex-col bg-gray-900 min-h-0 relative">
    <div v-if="traceSteps.length === 0" class="absolute inset-0 flex items-center justify-center text-gray-500 z-10 pointer-events-none">
      <p>Click "Build & Trace" to visualize instantiations</p>
    </div>
    
    <Graph :steps="traceSteps" :current-index="currentStepIndex" :tree="treeData" v-if="traceSteps.length > 0" class="w-full h-full" />
    
    <!-- Floating Scrubber Overlay (smaller and no subtitle text) -->
    <div v-if="traceSteps.length > 0" class="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-3/4 max-w-sm flex items-center justify-between bg-gray-900/85 backdrop-blur border border-gray-700/60 rounded-full py-1.5 px-4 shadow-xl z-20 space-x-3">
      
      <button 
        @click="handleStep('back')" 
        :disabled="logicalStepIndex < 0"
        class="p-1 rounded-full hover:bg-gray-700/80 disabled:opacity-30 disabled:hover:bg-transparent text-gray-200 transition-colors"
        title="Step Back"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
      </button>

      <input 
        type="range" 
        min="-1" 
        :max="logicalMaxSteps - 1" 
        v-model.number="progress"
        class="flex-1 h-1.5 bg-gray-700/80 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:bg-gray-600 transition-colors"
      />

      <button 
        @click="handleStep('in')" 
        :disabled="logicalStepIndex >= logicalMaxSteps - 1"
        class="p-1 rounded-full hover:bg-gray-700/80 disabled:opacity-30 disabled:hover:bg-transparent text-emerald-400 transition-colors"
        title="Step In"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
input[type=range] {
  -webkit-appearance: none;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 14px;
  width: 14px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.8);
  transition: transform 0.1s ease-out;
}
input[type=range]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
</style>
