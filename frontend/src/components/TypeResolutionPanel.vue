<script setup lang="ts">
import { computed } from 'vue';
import { globalValues } from '../store';

// We compute all type chains from globalValues
const typeChains = computed(() => {
  const values = globalValues.value;
  const chains: { alias: string, chain: string[] }[] = [];
  
  // To avoid circular loops and redundant paths, we just trace from every key
  for (const [key, val] of Object.entries(values)) {
    // Only trace if it's an alias (heuristic: exists as a key, but we don't strictly know if it's a root alias)
    // Actually, any key in globalValues could be traced.
    
    // We just want to show the full resolution for this key.
    const chain = [val];
    let current = val;
    let maxDepth = 20;
    while (maxDepth-- > 0) {
      if (values[current]) {
        current = values[current];
        chain.push(current);
      } else {
        break;
      }
    }
    chains.push({ alias: key, chain });
  }
  
  // Filter out variables and simple primitives that don't have a chain if they aren't useful
  // But globalValues only contains type aliases (and constexprs which don't map to other keys usually)
  return chains.sort((a, b) => a.alias.localeCompare(b.alias));
});
</script>

<template>
  <div class="h-full w-full bg-gray-900 min-h-0 flex flex-col p-4 text-sm text-gray-200 overflow-auto">
    <h2 class="text-gray-400 font-semibold mb-4 uppercase text-xs tracking-wider">Global Type Resolutions</h2>
    <div v-if="typeChains.length === 0" class="text-gray-500 italic">No type aliases found in the current trace.</div>
    <div v-for="item in typeChains" :key="item.alias" class="mb-6 font-mono text-xs">
      <div class="text-blue-400 font-bold mb-1">{{ item.alias }}</div>
      <div class="pl-4 border-l-2 border-gray-700 flex flex-col space-y-1">
        <div v-for="(step, index) in item.chain" :key="index" class="flex items-center text-gray-300">
          <span class="text-gray-500 mr-2 text-[10px]" v-if="index > 0">➔</span>
          <span class="text-gray-500 mr-2 text-[10px]" v-else>=</span>
          <span :class="{'text-green-300': index === item.chain.length - 1, 'text-orange-300': index < item.chain.length - 1}">
            {{ step }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
