<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { traceSteps, logicalStepIndex } from '../store';

const currentSteps = computed(() => {
  if (logicalStepIndex.value < 0) return [];
  return traceSteps.value.slice(0, logicalStepIndex.value + 1);
});

const listContainer = ref<HTMLElement | null>(null);

// Auto-scroll to bottom when new steps are added
watch(() => currentSteps.value.length, async () => {
  await nextTick();
  if (listContainer.value) {
    listContainer.value.scrollTop = listContainer.value.scrollHeight;
  }
});

function formatName(name: string) {
  return name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getKindExplanation(kind: number | undefined) {
  if (kind === undefined) return null;
  switch (kind) {
    case 0: return "Instantiating function/class definition (body)";
    case 3: 
    case 4: return "Substituting arguments for overload resolution / signature check. This often triggers the instantiation of classes used in the return type (SFINAE check).";
    default: return null;
  }
}
</script>

<template>
  <div class="h-full w-full bg-gray-950 text-gray-300 font-mono text-sm overflow-y-auto p-4 custom-scrollbar flex flex-col space-y-3" ref="listContainer">
    
    <div v-if="currentSteps.length === 0" class="flex h-full items-center justify-center text-gray-600 italic">
      No compilation steps yet.
    </div>

    <div 
      v-for="(step, index) in currentSteps" 
      :key="index"
      class="p-2.5 rounded border-l-4 transition-all duration-300 shadow-sm"
      :class="[
        index === currentSteps.length - 1 
          ? 'bg-gray-800/80 border-blue-500 text-gray-100 ring-1 ring-blue-500/30' 
          : 'bg-gray-900/50 border-gray-700 text-gray-400 opacity-70'
      ]"
    >
      <div v-if="step.type === 'begin'" class="flex flex-col">
        <div class="flex items-start">
          <span class="text-blue-400 font-bold mr-2">▶</span>
          <span>
            Evaluating <span class="text-purple-300 italic" v-html="formatName(step.name)"></span>
          </span>
        </div>
        <div v-if="getKindExplanation(step.kind)" class="ml-5 mt-1 text-xs text-gray-500 italic">
          // {{ getKindExplanation(step.kind) }}
        </div>
      </div>

      <div v-else-if="step.type === 'end'" class="flex items-start">
        <span class="text-emerald-400 font-bold mr-2">✔</span>
        <div class="flex flex-col">
          <span>
            Resolved <span class="text-purple-300 italic" v-html="formatName(step.name)"></span>
          </span>
          <div v-if="step.values && Object.keys(step.values).length > 0" class="mt-1 text-xs bg-gray-950/50 p-1.5 rounded inline-block border border-gray-800">
            <span class="text-gray-500">Result: </span>
            <span class="text-emerald-300" v-for="(val, key) in step.values" :key="key">
              <span class="text-blue-300">{{ key }}</span> = {{ val }} 
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: #111827; 
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #374151; 
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #4B5563; 
}
</style>
