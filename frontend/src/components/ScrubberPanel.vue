<script setup lang="ts">
import { computed } from 'vue';
import { 
  traceSteps, 
  logicalStepIndex,
  logicalMaxSteps,
  activeExplanation,
  setStepIndex,
  handleStep
} from '../store';

const progress = computed({
  get: () => logicalStepIndex.value,
  set: (val: number) => setStepIndex(val)
});

</script>

<template>
  <div class="h-full w-full flex flex-col bg-gray-900 border-t border-gray-800 p-2">
    <!-- Subtitle explanation -->
    <div class="flex-1 flex items-center justify-center text-center px-4 overflow-hidden mb-2">
      <span class="text-sm font-medium text-blue-300 drop-shadow-md truncate" :title="activeExplanation">
        {{ activeExplanation }}
      </span>
    </div>

    <!-- Scrubber and Controls -->
    <div class="flex items-center space-x-4 px-2">
      <button 
        @click="handleStep('back')" 
        :disabled="logicalStepIndex < 0 || traceSteps.length === 0"
        class="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent text-gray-400"
        title="Step Back"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
      </button>

      <input 
        type="range" 
        min="-1" 
        :max="logicalMaxSteps - 1" 
        v-model.number="progress"
        class="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        :disabled="traceSteps.length === 0"
      />

      <button 
        @click="handleStep('in')" 
        :disabled="logicalStepIndex >= logicalMaxSteps - 1 || traceSteps.length === 0"
        class="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent text-emerald-400"
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
  height: 16px;
  width: 16px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
  transition: transform 0.1s;
}
input[type=range]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
</style>
