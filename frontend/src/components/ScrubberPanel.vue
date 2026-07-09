<script setup lang="ts">
import StepControls from './StepControls.vue';
import { activeExplanation } from '../store';
</script>

<template>
  <div class="h-full w-full flex flex-col bg-gray-900 border-t border-gray-800 p-2">
    <!-- Step explanation subtitle -->
    <div class="flex-1 flex items-center justify-center text-center px-4 overflow-hidden mb-2">
      <span class="text-sm font-medium text-blue-300 drop-shadow-md truncate" :title="activeExplanation">
        {{ activeExplanation }}
      </span>
    </div>

    <!-- Step controls -->
    <div class="flex items-center space-x-4 px-2">
      <StepControls />
    </div>
  </div>
</template>
