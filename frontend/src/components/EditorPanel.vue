<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import Editor from './Editor.vue';
import { code, activeLocation } from '../store';
</script>

<template>
  <div class="h-full w-full bg-[#1e1e1e] flex flex-col min-h-0 relative">
    <Editor v-model="code" :activeLocation="activeLocation" />
  </div>
</template>
