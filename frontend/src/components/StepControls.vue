<!--
  Copyright (c) 2026 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import {
  traceSteps,
  logicalStepIndex,
  logicalMaxSteps,
  setStepIndex,
  handleStep,
  isPlaying,
  playSpeed,
  togglePlay
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

  <button
    @click="togglePlay"
    :disabled="traceSteps.length === 0"
    :class="[
      'disabled:opacity-30 text-gray-200 transition-colors',
      compact ? 'p-1 rounded-full hover:bg-gray-700/80' : 'p-1.5 rounded hover:bg-gray-700'
    ]"
    :title="isPlaying ? 'Pause (Space)' : 'Play the trace step by step (Space)'"
  >
    <svg v-if="!isPlaying" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    <svg v-else class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
  </button>
  <select
    v-model.number="playSpeed"
    class="bg-transparent text-[11px] text-gray-400 outline-none cursor-pointer"
    title="Playback speed (steps per second)"
  >
    <option :value="1">1×</option>
    <option :value="4">4×</option>
    <option :value="12">12×</option>
    <option :value="40">40×</option>
  </select>
  <span class="text-[11px] text-gray-400 tabular-nums whitespace-nowrap" title="Current step / total steps">{{ logicalStepIndex + 1 }}/{{ logicalMaxSteps }}</span>
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
