<script setup lang="ts">
const props = defineProps<{
    canStep: boolean,
    stepIndex: number,
    maxSteps: number
}>();

const emit = defineEmits<{
    (e: 'step', action: 'back' | 'in' | 'over' | 'out'): void
}>();
</script>

<template>
  <div class="flex items-center space-x-4">
    <div class="flex items-center space-x-2 bg-gray-900 rounded-md border border-gray-700 p-1">
      <button 
        @click="emit('step', 'back')" 
        :disabled="!canStep || stepIndex < 0"
        class="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent text-gray-400 tooltip-trigger relative group"
        title="Step Back"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
      </button>
      <div class="w-px h-6 bg-gray-700 mx-1"></div>
      <button 
        @click="emit('step', 'in')" 
        :disabled="!canStep || stepIndex >= maxSteps - 1"
        class="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent text-emerald-400 tooltip-trigger relative group"
        title="Step In"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>
      </button>
    </div>

    <!-- Progress Bar moved to App.vue -->
  </div>
</template>
