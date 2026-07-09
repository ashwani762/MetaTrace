<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { compileOutput } from '../store';
</script>

<template>
  <div class="h-full w-full bg-gray-900 text-gray-200 flex flex-col p-2 overflow-auto font-mono text-sm">
    <pre class="whitespace-pre-wrap" v-if="compileOutput">{{ compileOutput }}</pre>
    <div v-else class="text-gray-500 italic flex items-center justify-center h-full">No output</div>
  </div>
</template>
