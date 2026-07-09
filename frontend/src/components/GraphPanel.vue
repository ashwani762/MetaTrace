<script setup lang="ts">
import Graph from './Graph.vue';
import StepControls from './StepControls.vue';
import { 
  traceSteps, 
  currentStepIndex, 
  treeData
} from '../store';
</script>

<template>
  <div class="h-full w-full flex flex-col bg-gray-900 min-h-0 relative">
    <div v-if="traceSteps.length === 0" class="absolute inset-0 flex items-center justify-center text-gray-500 z-10 pointer-events-none">
      <p>Click "Build & Trace" to visualize instantiations</p>
    </div>
    
    <Graph :steps="traceSteps" :current-index="currentStepIndex" :tree="treeData" v-if="traceSteps.length > 0" class="w-full h-full" />
    
    <!-- Floating Scrubber Overlay (smaller and no subtitle text) -->
    <div v-if="traceSteps.length > 0" class="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-3/4 max-w-sm flex items-center justify-between bg-gray-900/85 backdrop-blur border border-gray-700/60 rounded-full py-1.5 px-4 shadow-xl z-20 space-x-3">
      <StepControls :compact="true" />
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
