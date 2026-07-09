<script setup lang="ts">
import Graph from './Graph.vue';
import { traceSteps, currentStepIndex, treeData } from '../store';
</script>

<template>
  <div class="h-full w-full flex flex-col bg-gray-900 min-h-0 relative">
    <div v-if="traceSteps.length === 0" class="absolute inset-0 flex items-center justify-center text-gray-500 z-10 pointer-events-none">
      <p>Click "Build & Trace" to visualize instantiations</p>
    </div>
    <Graph :steps="traceSteps" :current-index="currentStepIndex" :tree="treeData" v-if="traceSteps.length > 0" class="w-full h-full" />
  </div>
</template>
