<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { VueFlow, useVueFlow, Position, MarkerType } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/controls/dist/style.css';
import dagre from 'dagre';
import { selectedNodeId } from '../store';

const THEME = {
    selected: { bg: '#4c1d95', border: '#a78bfa' }, // Purple
    failed: { bg: '#450a0a', border: '#ef4444' }, // Red
    aliasCurrent: { bg: '#9a3412', border: '#fb923c' }, // Orange-800
    aliasActive: { bg: '#431407', border: '#f97316' }, // Orange-950
    aliasFinished: { bg: '#7c2d12', border: '#ea580c' }, // Orange-900
    aliasDefault: { bg: '#431407', border: '#9a3412' },
    normalCurrent: { bg: '#1e3a8a', border: '#60a5fa' }, // Blue-900
    normalActive: { bg: '#172554', border: '#3b82f6' }, // Blue-950
    normalFinished: { bg: '#064e3b', border: '#10b981' }, // Emerald-900
    normalDefault: { bg: '#1f2937', border: '#374151' } // Gray-800
};

const LEGEND_ITEMS = [
    { label: 'Selected Node', colors: THEME.selected },
    { label: 'Error / SFINAE Failure', colors: THEME.failed },
    { label: 'Template (Active)', colors: THEME.normalCurrent },
    { label: 'Template (In Progress)', colors: THEME.normalActive },
    { label: 'Template (Completed)', colors: THEME.normalFinished },
    { label: 'Type Alias (Active)', colors: THEME.aliasCurrent },
    { label: 'Type Alias (In Progress)', colors: THEME.aliasActive },
    { label: 'Type Alias (Completed)', colors: THEME.aliasFinished }
];
const props = defineProps<{
    steps: any[],
    currentIndex: number,
    tree: any[]
}>();

const { fitView, setCenter, onNodesInitialized } = useVueFlow();

const nodes = ref<any[]>([]);
const edges = ref<any[]>([]);

// Tooltip state
const hoveredNodeId = ref<string | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });
const tooltipPinned = ref(false);

/**
 * Parses a C++ template name into its base name and arguments.
 * Also checks the step history to determine the node's current status and return values.
 * 
 * @param nodeName - The raw template name (e.g. "Factorial<5>")
 * @param nodeId - The unique ID of the node to check status in the step history
 * @returns An array of name/value pairs for the tooltip
 */
function parseNodeVars(nodeName: string, nodeId: string) {
    const vars: { name: string, value: string }[] = [];
    const match = nodeName.match(/^([^<]+)<(.+)>$/);

    if (!match) {
        vars.push({ name: 'Template', value: nodeName });
    } else {
        vars.push({ name: 'Template', value: match[1].trim() });
        const argsStr = match[2];
        const args: string[] = [];
        let depth = 0;
        let currentArg = '';
        for (let i = 0; i < argsStr.length; i++) {
            const c = argsStr[i];
            if (c === '<') depth++;
            else if (c === '>') depth--;
            else if (c === ',' && depth === 0) {
                args.push(currentArg.trim());
                currentArg = '';
                continue;
            }
            currentArg += c;
        }
        if (currentArg.trim()) args.push(currentArg.trim());
        args.forEach((arg, idx) => vars.push({ name: `Arg ${idx + 1}`, value: arg }));
    }

    // Check if node has a computed value (find end step for this id)
    const endStep = props.steps.find(s => String(s.id) === nodeId && s.type === 'end');
    if (endStep && endStep.values) {
        for (const key of Object.keys(endStep.values)) {
            vars.push({ name: `↪ ${key}`, value: String(endStep.values[key]) });
        }
    }

    // Check status
    const beginIdx = props.steps.findIndex(s => String(s.id) === nodeId && s.type === 'begin');
    const endIdx = props.steps.findIndex(s => String(s.id) === nodeId && s.type === 'end');
    if (endIdx >= 0 && endIdx <= props.currentIndex) {
        vars.push({ name: 'Status', value: '✅ Completed' });
    } else if (beginIdx >= 0 && beginIdx <= props.currentIndex) {
        vars.push({ name: 'Status', value: '⏳ In Progress' });
    }

    function findNodeRecursive(treeNodes: any[], idToFind: string): any | null {
        for (const n of treeNodes) {
            if (String(n.id) === idToFind) return n;
            const child = findNodeRecursive(n.children || [], idToFind);
            if (child) return child;
        }
        return null;
    }

    const nodeData = findNodeRecursive(props.tree, nodeId);
    if (nodeData) {
        if (nodeData.dur !== undefined) vars.push({ name: 'Duration', value: `${(nodeData.dur / 1000).toFixed(3)} ms` });
        if (nodeData.failed) {
            vars.push({ name: 'Error', value: nodeData.failReason || 'Unknown failure' });
        }
    }

    return vars;
}

const tooltipData = computed(() => {
    const id = tooltipPinned.value ? selectedNodeId.value : hoveredNodeId.value;
    if (!id) return null;
    function findNodeRecursive(treeNodes: any[], idToFind: string): any | null {
        for (const n of treeNodes) {
            if (String(n.id) === idToFind) return n;
            const child = findNodeRecursive(n.children || [], idToFind);
            if (child) return child;
        }
        return null;
    }
    const nodeData = findNodeRecursive(props.tree, id);
    if (!nodeData) return null;
    const name = nodeData.name;
    return { name, vars: parseNodeVars(name, id) };
});

const onNodeClick = (event: any) => {
    const id = String(event.node.id);
    if (tooltipPinned.value && selectedNodeId.value === id) {
        tooltipPinned.value = false;
        selectedNodeId.value = null;
    } else {
        selectedNodeId.value = id;
        tooltipPinned.value = true;
        // Search tree for node location
        function findNodeRecursive(treeNodes: any[], idToFind: string): any | null {
            for (const n of treeNodes) {
                if (String(n.id) === idToFind) return n;
                const child = findNodeRecursive(n.children || [], idToFind);
                if (child) return child;
            }
            return null;
        }
        const nodeData = findNodeRecursive(props.tree, id);
        if (nodeData && nodeData.line && nodeData.col) {
            // We set it globally via a new ref in store or emit. We'll use activeLocation.
            // Wait, activeLocation is currently computed from activeStack.
            // We can emit a custom event to window or store.
            window.dispatchEvent(new CustomEvent('editor-highlight', { 
                detail: { line: nodeData.line, col: nodeData.col }
            }));
        }
    }
};

const onNodeMouseEnter = (event: any) => {
    if (tooltipPinned.value) return;
    hoveredNodeId.value = String(event.node.id);
    const domEvent = event.event as MouseEvent;
    tooltipPos.value = { x: domEvent.clientX, y: domEvent.clientY };
};

const onNodeMouseLeave = () => {
    if (tooltipPinned.value) return;
    hoveredNodeId.value = null;
};

const onPaneClick = () => {
    tooltipPinned.value = false;
    selectedNodeId.value = null;
    hoveredNodeId.value = null;
};

const isExporting = ref(false);

/**
 * Wraps `text` into lines that each fit within `maxWidth` pixels (canvas units).
 * Prefers breaking at C++ template delimiters: < > , :: space
 * Returns at most `maxLines` lines; the last line is never truncated.
 */
function wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines = 4
): string[] {
    if (ctx.measureText(text).width <= maxWidth) return [text];

    const lines: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (lines.length >= maxLines) break;

        if (ctx.measureText(remaining).width <= maxWidth) {
            lines.push(remaining);
            remaining = '';
            break;
        }

        // Binary-search: find max chars that fit on this line
        let lo = 1, hi = remaining.length - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            if (ctx.measureText(remaining.slice(0, mid)).width <= maxWidth) lo = mid;
            else hi = mid - 1;
        }

        // Walk backwards from `lo` to find a good C++ break point
        const breakChars = [',', '<', ' ', ':', '>'];
        let breakAt = lo;
        for (let i = lo; i >= Math.max(1, lo - 20); i--) {
            if (breakChars.includes(remaining[i - 1])) {
                breakAt = i;
                break;
            }
        }

        lines.push(remaining.slice(0, breakAt).trimEnd());
        remaining = remaining.slice(breakAt).trimStart();
    }

    return lines.filter(l => l.length > 0);
}

const downloadImage = async () => {
    if (isExporting.value || nodes.value.length === 0) return;
    isExporting.value = true;

    try {
        // Layout constants – must match the dagre setNode() call in the watch()
        const NODE_W   = 350;
        const BASE_H   = 60;   // dagre-assigned height; we may grow taller for text
        const PADDING  = 80;
        const SCALE    = 3;    // 3× super-sampling → crisp text

        const fontSize   = 11 * SCALE;          // px on canvas
        const lineHeight = 16 * SCALE;           // leading between wrapped lines
        const padX       = 14 * SCALE;           // horizontal inner padding for text
        const padY       = 10 * SCALE;           // vertical inner padding top & bottom

        // ── Step 1: measure every node's text height so we know its real height ──
        // We need a throwaway canvas just for text measurement.
        const measureCanvas = document.createElement('canvas');
        const mCtx = measureCanvas.getContext('2d')!;
        mCtx.font = `${fontSize}px "Courier New", Courier, monospace`;

        const nodeHeights = new Map<string, number>(); // nodeId → canvas px height
        const nodeLines   = new Map<string, string[]>(); // nodeId → wrapped lines

        for (const n of nodes.value) {
            const label    = (n.data?.label ?? '') as string;
            const maxTextW = NODE_W * SCALE - padX * 2;
            const lines    = wrapText(mCtx, label, maxTextW, 4);
            nodeLines.set(n.id, lines);

            const textBlockH = fontSize + (lines.length - 1) * lineHeight;
            const neededH    = textBlockH + padY * 2;
            nodeHeights.set(n.id, Math.max(BASE_H * SCALE, neededH));
        }

        // ── Step 2: compute bounding box using real heights ──
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes.value) {
            const rh = nodeHeights.get(n.id)! / SCALE; // back to graph units
            minX = Math.min(minX, n.position.x);
            minY = Math.min(minY, n.position.y);
            maxX = Math.max(maxX, n.position.x + NODE_W);
            maxY = Math.max(maxY, n.position.y + rh);
        }

        const graphW = maxX - minX + PADDING * 2;
        const graphH = maxY - minY + PADDING * 2;

        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(graphW * SCALE);
        canvas.height = Math.round(graphH * SCALE);
        const ctx = canvas.getContext('2d')!;

        const tx = (x: number) => (x - minX + PADDING) * SCALE;
        const ty = (y: number) => (y - minY + PADDING) * SCALE;

        // ── Background ──
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Dot grid
        ctx.fillStyle = '#374151';
        const dotSpacing = 20 * SCALE;
        const dotR       = 1.2 * SCALE;
        for (let gx = 0; gx < canvas.width; gx += dotSpacing) {
            for (let gy = 0; gy < canvas.height; gy += dotSpacing) {
                ctx.beginPath();
                ctx.arc(gx, gy, dotR, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ── Step 3: build node lookup (with real heights) for edge drawing ──
        const nodeMap = new Map<string, { x: number; y: number; h: number; style: any }>();
        for (const n of nodes.value) {
            nodeMap.set(n.id, {
                x: n.position.x,
                y: n.position.y,
                h: nodeHeights.get(n.id)! / SCALE,
                style: n.style
            });
        }

        // ── Step 4: draw edges (using real node bottom) ──
        for (const edge of edges.value) {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) continue;

            const sx = tx(src.x + NODE_W / 2);
            const sy = ty(src.y + src.h);        // bottom of source node
            const ex = tx(tgt.x + NODE_W / 2);
            const ey = ty(tgt.y);                 // top of target node

            const color = edge.style?.stroke ?? '#9ca3af';
            ctx.strokeStyle = color;
            ctx.lineWidth   = 2.5 * SCALE;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';

            const midY = (sy + ey) / 2;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.bezierCurveTo(sx, midY, ex, midY, ex, ey);
            ctx.stroke();

            // Arrowhead at target top
            const arrowSize = 7 * SCALE;
            ctx.save();
            ctx.translate(ex, ey);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-arrowSize / 2, -arrowSize);
            ctx.lineTo( arrowSize / 2, -arrowSize);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // ── Step 5: draw nodes ──
        ctx.font = `${fontSize}px "Courier New", Courier, monospace`;

        for (const n of nodes.value) {
            const info = nodeMap.get(n.id)!;
            const x   = tx(info.x);
            const y   = ty(info.y);
            const w   = NODE_W * SCALE;
            const h   = nodeHeights.get(n.id)!;
            const style = n.style ?? {};

            // Parse border
            let borderColor = '#374151';
            let borderStyle = 'solid';
            if (style.border) {
                const parts = style.border.split(' ');
                borderStyle = parts[1] ?? 'solid';
                borderColor = parts[2] ?? '#374151';
            }
            const bgColor = style.background ?? '#1f2937';

            // Glow / shadow
            if (style.boxShadow && style.boxShadow !== 'none') {
                ctx.shadowColor = borderColor;
                ctx.shadowBlur  = 16 * SCALE;
            } else {
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur  = 0;
            }

            const br = 8 * SCALE;

            // Fill
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, br);
            ctx.fill();

            ctx.shadowColor = 'transparent';
            ctx.shadowBlur  = 0;

            // Border
            ctx.strokeStyle = borderColor;
            ctx.lineWidth   = 2 * SCALE;
            ctx.setLineDash(borderStyle === 'dashed' ? [6 * SCALE, 4 * SCALE] : []);
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, br);
            ctx.stroke();
            ctx.setLineDash([]);

            // Text – multi-line, vertically centred in the node
            ctx.fillStyle   = '#ffffff';
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign   = 'center';

            const lines = nodeLines.get(n.id) ?? [];
            const totalTextH = fontSize + (lines.length - 1) * lineHeight;
            // topmost baseline offset from node top
            const firstBaselineY = y + (h - totalTextH) / 2 + fontSize;

            lines.forEach((line, i) => {
                ctx.fillText(line, x + w / 2, firstBaselineY + i * lineHeight);
            });
        }

        // ── Download ──
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'template-instantiation-graph.png';
        link.href = dataUrl;
        link.click();

    } catch (e) {
        console.error('Failed to export image', e);
    } finally {
        isExporting.value = false;
    }
};

// Rebuild the graph up to the current index
watch(() => [props.currentIndex, selectedNodeId.value], ([newIndexStr, selected]) => {
    const newIndex = newIndexStr as number;
    if (newIndex < 0 || !props.steps || props.steps.length === 0) {
        nodes.value = [];
        edges.value = [];
        return;
    }

    const currentNodes: any[] = [];
    const currentEdges: any[] = [];
    const activeIds = new Set();
    const finishedIds = new Set();
    
    // We only process steps up to newIndex
    for (let i = 0; i <= newIndex; i++) {
        const step = props.steps[i];
        if (step.type === 'begin') {
            activeIds.add(step.id);
        } else if (step.type === 'end') {
            activeIds.delete(step.id);
            finishedIds.add(step.id);
        }
    }

    // Use Dagre for layout
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 });

    function traverse(nodeData: any, parentId: string | null) {
        if (!activeIds.has(nodeData.id) && !finishedIds.has(nodeData.id)) {
            return;
        }

        const isActive = activeIds.has(nodeData.id);
        const isCurrent = props.steps[newIndex].id === nodeData.id;
        const isSelected = selected === String(nodeData.id);

        const nodeIdStr = String(nodeData.id);

        // Add to dagre graph to calculate positions
        dagreGraph.setNode(nodeIdStr, { width: 350, height: 60 });

        let labelText = nodeData.name;
        if (finishedIds.has(nodeData.id) && nodeData.value !== undefined) {
            labelText += ` = ${nodeData.value}`;
        }

        const isFinished = finishedIds.has(nodeData.id);

        let bgColor = THEME.normalDefault.bg;
        let borderColor = THEME.normalDefault.border;
        let shadow = 'none';
        let borderStyle = 'solid';

        if (isSelected) {
            bgColor = THEME.selected.bg;
            borderColor = THEME.selected.border;
            shadow = '0 0 15px rgba(124, 58, 237, 0.5)';
        } else if (nodeData.failed) {
            bgColor = THEME.failed.bg;
            borderColor = THEME.failed.border;
            borderStyle = 'dashed';
            shadow = '0 0 10px rgba(239, 68, 68, 0.4)';
            labelText = '❌ ' + labelText;
        } else if (nodeData.isAlias) {
            // Orange theme for aliases
            labelText = '🏷️ ' + labelText;
            if (isCurrent) {
                bgColor = THEME.aliasCurrent.bg;
                borderColor = THEME.aliasCurrent.border;
                shadow = '0 0 15px rgba(251, 146, 60, 0.5)';
            } else if (isActive) {
                bgColor = THEME.aliasActive.bg;
                borderColor = THEME.aliasActive.border;
            } else if (isFinished) {
                bgColor = THEME.aliasFinished.bg;
                borderColor = THEME.aliasFinished.border;
            } else {
                bgColor = THEME.aliasDefault.bg;
                borderColor = THEME.aliasDefault.border;
            }
        } else if (isCurrent) {
            bgColor = THEME.normalCurrent.bg;
            borderColor = THEME.normalCurrent.border;
            shadow = '0 0 15px rgba(59, 130, 246, 0.5)';
        } else if (isActive) {
            bgColor = THEME.normalActive.bg;
            borderColor = THEME.normalActive.border;
        } else if (isFinished) {
            bgColor = THEME.normalFinished.bg;
            borderColor = THEME.normalFinished.border;
        }

        currentNodes.push({
            id: nodeIdStr,
            position: { x: 0, y: 0 }, // Will be updated by dagre
            data: { label: labelText },
            style: {
                background: bgColor,
                color: '#fff',
                border: `2px ${borderStyle} ${borderColor}`,
                borderRadius: '8px',
                padding: '10px',
                fontSize: '11px',
                fontFamily: 'monospace',
                width: '350px',
                boxShadow: shadow,
                wordBreak: 'break-all',
                cursor: 'pointer'
            },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top
        });

        if (parentId) {
            dagreGraph.setEdge(parentId, nodeIdStr);
            currentEdges.push({
                id: `e-${parentId}-${nodeIdStr}`,
                source: parentId,
                target: nodeIdStr,
                type: 'smoothstep',
                animated: isActive,
                style: { stroke: isActive ? '#60a5fa' : '#9ca3af', strokeWidth: 3 },
                markerEnd: { type: MarkerType.ArrowClosed, color: isActive ? '#60a5fa' : '#9ca3af' }
            });
        }

        for (const child of nodeData.children || []) {
            traverse(child, nodeIdStr);
        }
    }

    for (const root of props.tree) {
        traverse(root, null);
    }

    // Execute dagre layout
    dagre.layout(dagreGraph);

    // Update node positions
    currentNodes.forEach(node => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.position = {
            x: nodeWithPosition.x - nodeWithPosition.width / 2,
            y: nodeWithPosition.y - nodeWithPosition.height / 2
        };
    });

    nodes.value = currentNodes;
    edges.value = currentEdges;
}, { immediate: true });

function centerOnCurrentStep() {
    const currentStepId = props.steps[props.currentIndex]?.id;
    if (currentStepId !== undefined) {
      const isCurrent = nodes.value.find(n => n.id === String(currentStepId));
      if (isCurrent) {
          setCenter(isCurrent.position.x + 175, isCurrent.position.y + 30, { zoom: 1.1, duration: 800 });
      } else {
          fitView({ padding: 0.2, duration: 800 });
      }
    }
}

onNodesInitialized(() => {
    centerOnCurrentStep();
});

watch(() => props.currentIndex, () => {
  // Only pan when stepping, not when selecting
  setTimeout(() => {
    centerOnCurrentStep();
  }, 50);
});

</script>

<template>
  <div class="h-full w-full relative">
    
    <!-- Top-Right Controls overlay for Graph specific actions -->
    <div class="absolute top-2 right-2 z-10 flex space-x-2">
        <button 
            @click="downloadImage" 
            :disabled="isExporting || nodes.length === 0"
            class="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 border border-gray-700 text-xs px-2 py-1 rounded shadow flex items-center transition-colors"
            title="Export full graph as high-resolution PNG"
        >
            <svg v-if="!isExporting" class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            <svg v-else class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            {{ isExporting ? 'Exporting…' : 'Export PNG' }}
        </button>
    </div>

    <!-- Bottom-Right Legend overlay -->
    <div class="absolute bottom-4 right-4 z-10 bg-gray-900/90 backdrop-blur-sm border border-gray-700 p-3 rounded-lg shadow-xl text-xs font-medium text-gray-300">
      <div class="mb-2 text-gray-400 font-semibold border-b border-gray-700 pb-1">Legend</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-2">
        <div v-for="item in LEGEND_ITEMS" :key="item.label" class="flex items-center">
            <div class="w-3 h-3 rounded mr-2 border" :style="{ background: item.colors.bg, borderColor: item.colors.border }"></div>
            {{ item.label }}
        </div>
      </div>
    </div>

    <VueFlow
      :nodes="nodes"
      :edges="edges"
      @node-click="onNodeClick"
      @node-mouse-enter="onNodeMouseEnter"
      @node-mouse-leave="onNodeMouseLeave"
      @pane-click="onPaneClick"
      class="vue-flow-dark"
      :default-viewport="{ zoom: 1 }"
      :min-zoom="0.1"
      :max-zoom="4"
    >
      <Background pattern-color="#374151" :gap="20" />
      <Controls :showInteractive="false" />
    </VueFlow>

    <!-- Node Info Tooltip -->
    <Transition name="tooltip-fade">
      <div
        v-if="tooltipData"
        class="node-tooltip"
        :class="{ 'pinned': tooltipPinned }"
        :style="{
          left: tooltipPinned ? '12px' : (tooltipPos.x + 16) + 'px',
          top: tooltipPinned ? '12px' : (tooltipPos.y - 20) + 'px',
          position: tooltipPinned ? 'absolute' : 'fixed'
        }"
      >
        <div class="tooltip-header">
          <span class="tooltip-icon">⚡</span>
          {{ tooltipData.name }}
          <span v-if="tooltipPinned" class="pin-badge">pinned</span>
        </div>
        <div class="tooltip-body">
          <div v-for="v in tooltipData.vars" :key="v.name" class="tooltip-row">
            <span class="tooltip-key">{{ v.name }}</span>
            <span class="tooltip-val">{{ v.value }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.node-tooltip {
  z-index: 1000;
  pointer-events: none;
  min-width: 200px;
  max-width: 380px;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 1px solid #334155;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.15);
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
}
.node-tooltip.pinned {
  pointer-events: auto;
  border-color: #6366f1;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 12px rgba(99,102,241,0.3);
}
.tooltip-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #e2e8f0;
  background: rgba(99,102,241,0.1);
  border-bottom: 1px solid #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}
.tooltip-icon {
  font-size: 12px;
  flex-shrink: 0;
}
.pin-badge {
  margin-left: auto;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #818cf8;
  background: rgba(99,102,241,0.15);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.tooltip-body {
  padding: 6px 0;
}
.tooltip-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 3px 12px;
  gap: 12px;
}
.tooltip-row:hover {
  background: rgba(255,255,255,0.03);
}
.tooltip-key {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}
.tooltip-val {
  font-size: 11px;
  color: #a5f3fc;
  font-family: 'JetBrains Mono', monospace;
  text-align: right;
  word-break: break-all;
}

/* Transition */
.tooltip-fade-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.tooltip-fade-leave-active {
  transition: opacity 0.1s ease;
}
.tooltip-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.tooltip-fade-leave-to {
  opacity: 0;
}
</style>
