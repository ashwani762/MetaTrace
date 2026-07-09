<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { activeStack } from '../store';
</script>

<template>
  <div class="h-full w-full bg-gray-900 min-h-0 flex flex-col">
    <div class="flex-1 overflow-auto p-2 font-mono text-xs">
      <div v-if="activeStack.length === 0" class="text-gray-600 italic px-2 py-1">Stack is empty</div>
      <div 
        v-for="(frame, idx) in activeStack" 
        :key="frame.id"
        class="px-2 py-1 truncate flex items-center"
        :class="idx === 0 ? 'bg-blue-900/30 text-blue-300' : 'text-gray-400'"
      >
        <span class="w-6 text-gray-600 shrink-0 text-right mr-2">{{ activeStack.length - idx - 1 }}</span>
        <span class="truncate" :title="frame.name">{{ frame.name }}</span>
      </div>
    </div>
  </div>
</template>
