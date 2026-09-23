<!--
  Copyright (c) 2026 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import Editor from './Editor.vue';
import { computed } from 'vue';
import { code, activeLocation, lineHeat, diagnostics } from '../store';

const markers = computed(() => diagnostics.value.flatMap(d => [d, ...d.notes]).filter(d => d.inMainFile));
</script>

<template>
  <div data-tour="editor" class="h-full w-full bg-[#1e1e1e] flex flex-col min-h-0 relative">
    <Editor v-model="code" :activeLocation="activeLocation" :heat="lineHeat" :markers="markers" />
  </div>
</template>
