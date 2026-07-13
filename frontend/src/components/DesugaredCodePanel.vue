<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { computed } from 'vue';
import { traceSteps, currentStepIndex, selectedNodeId, treeData } from '../store';
import Editor from './Editor.vue';

function findNodeInTree(nodes: any[], id: string): any {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children && n.children.length > 0) {
      const found = findNodeInTree(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

const activeDesugaredCode = computed(() => {
  if (selectedNodeId.value && treeData.value.length > 0) {
    const node = findNodeInTree(treeData.value, selectedNodeId.value);
    if (node && node.desugaredCode) {
      return node.desugaredCode;
    }
  } else if (currentStepIndex.value >= 0 && traceSteps.value.length > 0) {
    const step = traceSteps.value[currentStepIndex.value];
    if (step && step.desugaredCode) {
      return step.desugaredCode;
    }
  }
  return "// No desugared code available for the currently selected template instantiation.\n// Make sure you select a completed definition node (solid green borders).";
});
</script>

<template>
  <div class="h-full w-full flex flex-col bg-gray-900 border-l border-gray-700">
    <div class="flex-1 min-h-0 relative">
      <Editor
        :modelValue="activeDesugaredCode"
        :readOnly="true"
      />
    </div>
  </div>
</template>
