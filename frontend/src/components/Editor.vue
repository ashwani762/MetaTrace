<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import * as monaco from 'monaco-editor'
import { SimpleLspClient } from '../lspClient'

const props = defineProps<{
  modelValue: string,
  activeLocation?: { line: number, col: number }
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editorContainer = ref<HTMLElement | null>(null)
const editorRef = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)
let decorationIds: string[] = []
let lspClient: SimpleLspClient | null = null;

const highlightLocation = (loc: { line: number, col: number } | undefined) => {
  if (!editorRef.value || !loc) {
    if (editorRef.value && decorationIds.length > 0) {
      editorRef.value.deltaDecorations(decorationIds, [])
      decorationIds = []
    }
    return
  }

  const model = editorRef.value.getModel()
  if (!model) return

  decorationIds = editorRef.value.deltaDecorations(decorationIds, [
    {
      range: new monaco.Range(loc.line, 1, loc.line, 1),
      options: {
        isWholeLine: true,
        className: 'active-template-line',
        glyphMarginClassName: 'active-template-glyph'
      }
    }
  ])
  editorRef.value.revealLineInCenterIfOutsideViewport(loc.line)
};

const handleCustomHighlight = (e: Event) => {
  const ce = e as CustomEvent;
  highlightLocation(ce.detail);
};

onMounted(() => {
  if (!editorContainer.value) return;

  // Initialize Monaco Editor
  const editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue,
    language: 'cpp',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Consolas, monospace',
    scrollBeyondLastLine: false,
    roundedSelection: false,
    padding: { top: 16 }
  });
  
  editorRef.value = editor;

  editor.onDidChangeModelContent(() => {
    emit('update:modelValue', editor.getValue());
  });

  // Setup custom Language Server Client
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/lsp`;
  lspClient = new SimpleLspClient(url, editor);

  window.addEventListener('editor-highlight', handleCustomHighlight);
});

onBeforeUnmount(() => {
  window.removeEventListener('editor-highlight', handleCustomHighlight);
  if (lspClient) {
    lspClient.dispose();
  }
  if (editorRef.value) {
    editorRef.value.dispose();
  }
});

watch(() => props.modelValue, (newVal) => {
  if (editorRef.value && newVal !== editorRef.value.getValue()) {
    editorRef.value.setValue(newVal);
  }
});

watch(() => props.activeLocation, (loc) => {
  highlightLocation(loc);
})
</script>

<template>
  <div ref="editorContainer" class="w-full h-full"></div>
</template>

<style>
.active-template-line {
  background: rgba(59, 130, 246, 0.2);
}
.active-template-glyph {
  background: #3b82f6;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-left: 5px;
}
</style>
