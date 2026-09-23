<!--
  Copyright (c) 2026 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import * as monaco from 'monaco-editor'
import { SimpleLspClient } from '../lspClient'

const props = defineProps<{
  modelValue: string,
  activeLocation?: { line: number, col: number },
  readOnly?: boolean,
  heat?: { line: number, count: number, failures: number, selfUs: number, names: string[] }[],
  markers?: { severity: string, line: number, col: number, message: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editorContainer = ref<HTMLElement | null>(null)
const editorRef = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)
let decorationIds: string[] = []
let heatDecorations: monaco.editor.IEditorDecorationsCollection | null = null
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

// Gutter markers showing how much template work each source line triggers
const applyHeat = () => {
  if (!editorRef.value || !heatDecorations) return
  const heat = props.heat || []
  const maxCount = Math.max(1, ...heat.map(h => h.count))
  const lineCount = editorRef.value.getModel()?.getLineCount() ?? 0
  heatDecorations.set(heat.filter(h => h.line <= lineCount).map(h => {
    const level = Math.min(4, Math.max(1, Math.ceil((h.count / maxCount) * 4)))
    const shown = h.names.slice(0, 6).map(n => '`' + n + '`').join(', ')
    const more = h.names.length > 6 ? ` and ${h.names.length - 6} more` : ''
    const failures = h.failures ? `

**${h.failures} failed substitution${h.failures === 1 ? '' : 's'}** (SFINAE)` : ''
    return {
      range: new monaco.Range(h.line, 1, h.line, 1),
      options: {
        glyphMarginClassName: h.failures ? 'heat-glyph heat-fail' : `heat-glyph heat-${level}`,
        glyphMarginHoverMessage: {
          value: `**${h.count} instantiation step${h.count === 1 ? '' : 's'}** triggered here · ${h.selfUs} µs self time

${shown}${more}${failures}`
        }
      }
    }
  }))
}

// Compiler diagnostics as squiggles in the editor
const applyMarkers = () => {
  const model = editorRef.value?.getModel()
  if (!model) return
  const severityOf = (s: string) => s === 'error' ? monaco.MarkerSeverity.Error
    : s === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info
  monaco.editor.setModelMarkers(model, 'metatrace', (props.markers || [])
    .filter(m => m.line <= model.getLineCount())
    .map(m => {
      const word = model.getWordAtPosition({ lineNumber: m.line, column: m.col })
      return {
        severity: severityOf(m.severity),
        message: m.message,
        startLineNumber: m.line,
        startColumn: m.col,
        endLineNumber: m.line,
        endColumn: word ? word.endColumn : m.col + 1
      }
    }))
}

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
    padding: { top: 16 },
    readOnly: props.readOnly || false,
    glyphMargin: props.heat !== undefined
  });
  
  editorRef.value = editor;
  heatDecorations = editor.createDecorationsCollection();
  applyHeat();
  applyMarkers();

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

watch(() => props.heat, applyHeat)
watch(() => props.markers, applyMarkers)

watch(() => props.activeLocation, (loc) => {
  highlightLocation(loc);
})
</script>

<template>
  <div ref="editorContainer" class="w-full h-full"></div>
</template>

<style>
.heat-glyph {
  width: 6px !important;
  margin-left: 8px;
  border-radius: 2px;
}
/* One hue, light to dark: more instantiations = stronger */
.heat-1 { background: rgba(96, 165, 250, 0.25); }
.heat-2 { background: rgba(96, 165, 250, 0.5); }
.heat-3 { background: rgba(96, 165, 250, 0.75); }
.heat-4 { background: rgba(96, 165, 250, 1); }
.heat-fail { background: #ef4444; }
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
