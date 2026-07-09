<script setup lang="ts">
import { activeVariables } from '../store';
</script>

<template>
  <div class="h-full w-full bg-gray-900 min-h-0 flex flex-col">
    <div class="flex-1 overflow-auto p-2 font-mono text-xs">
      <div v-if="activeVariables.length === 0" class="text-gray-600 italic px-2 py-1">No active variables</div>
      <table class="w-full text-left" v-if="activeVariables.length > 0">
        <thead>
          <tr class="text-gray-500 border-b border-gray-800">
            <th class="px-2 py-1 font-normal w-1/3">Name</th>
            <th class="px-2 py-1 font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="variable in activeVariables" :key="variable.name" class="border-b border-gray-800/50 hover:bg-gray-800/50">
            <td class="px-2 py-1.5 text-purple-400 whitespace-nowrap">{{ variable.name }}</td>
            <td class="px-2 py-1.5 text-blue-300 break-all">{{ variable.value }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
