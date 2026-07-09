<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import {
  traceSteps,
  logicalStepIndex,
  logicalMaxSteps,
  setStepIndex,
  handleStep
} from '../store';
import { computed } from 'vue';

const props = defineProps<{ compact?: boolean }>();

const progress = computed({
  get: () => logicalStepIndex.value,
  set: (val: number) => setStepIndex(val)
});
</script>

<template>
  <button
    @click="handleStep('back')"
    :disabled="logicalStepIndex < 0 || traceSteps.length === 0"
    :class="[
      'disabled:opacity-30 disabled:hover:bg-transparent text-gray-400 transition-colors',
      compact ? 'p-1 rounded-full hover:bg-gray-700/80 text-gray-200' : 'p-1.5 rounded hover:bg-gray-700'
    ]"
    title="Step Back"
  >
    <!-- Counter-clockwise rewind arrow -->
    <svg :class="compact ? 'w-5 h-5' : 'w-5 h-5'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <path d="M3 7v6h6"/>
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
    </svg>
  </button>

  <input
    type="range"
    min="-1"
    :max="logicalMaxSteps - 1"
    v-model.number="progress"
    :disabled="traceSteps.length === 0"
    :class="[
      'flex-1 rounded-lg appearance-none cursor-pointer accent-blue-500 bg-gray-700 transition-colors',
      compact ? 'h-1.5 hover:bg-gray-600' : 'h-2'
    ]"
  />

  <button
    @click="handleStep('in')"
    :disabled="logicalStepIndex >= logicalMaxSteps - 1 || traceSteps.length === 0"
    :class="[
      'disabled:opacity-30 disabled:hover:bg-transparent text-gray-400 transition-colors',
      compact ? 'p-1 rounded-full hover:bg-gray-700/80 text-gray-200' : 'p-1.5 rounded hover:bg-gray-700'
    ]"
    title="Step Forward"
  >
    <!-- Clockwise forward arrow — exact horizontal mirror of the rewind icon -->
    <svg :class="compact ? 'w-5 h-5' : 'w-5 h-5'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <path d="M21 7v6h-6"/>
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
    </svg>
  </button>
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
