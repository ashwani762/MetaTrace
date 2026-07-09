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

const props = defineProps<{
    steps: any[],
    currentIndex: number,
    tree: any[]
}>();

const { fitView, setCenter } = useVueFlow();

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

    return vars;
}

const tooltipData = computed(() => {
    const id = tooltipPinned.value ? selectedNodeId.value : hoveredNodeId.value;
    if (!id) return null;
    // Find the node name from the tree
    function findName(treeNodes: any[]): string | null {
        for (const n of treeNodes) {
            if (String(n.id) === id) return n.name;
            const child = findName(n.children || []);
            if (child) return child;
        }
        return null;
    }
    const name = findName(props.tree);
    if (!name) return null;
    return { name, vars: parseNodeVars(name, id) };
});

const onNodeClick = (event: any) => {
    const id = String(event.node.id);
    if (tooltipPinned.value && selectedNodeId.value === id) {
        // Clicking the same node again unpins
        tooltipPinned.value = false;
        selectedNodeId.value = null;
    } else {
        selectedNodeId.value = id;
        tooltipPinned.value = true;
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

        let bgColor = '#1f2937';
        let borderColor = '#374151';
        let shadow = 'none';

        if (isSelected) {
            bgColor = '#4c1d95';
            borderColor = '#a78bfa';
            shadow = '0 0 15px rgba(124, 58, 237, 0.5)';
        } else if (isCurrent) {
            bgColor = '#1e3a8a';
            borderColor = '#60a5fa';
            shadow = '0 0 15px rgba(59, 130, 246, 0.5)';
        } else if (isActive) {
            bgColor = '#1f2937';
            borderColor = '#3b82f6';
        } else if (isFinished) {
            bgColor = '#064e3b'; // Emerald-900
            borderColor = '#10b981'; // Emerald-500
        }

        currentNodes.push({
            id: nodeIdStr,
            position: { x: 0, y: 0 }, // Will be updated by dagre
            data: { label: labelText },
            style: {
                background: bgColor,
                color: '#fff',
                border: `2px solid ${borderColor}`,
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

watch(() => props.currentIndex, () => {
  // Only pan when stepping, not when selecting
  setTimeout(() => {
    const currentStepId = props.steps[props.currentIndex]?.id;
    if (currentStepId !== undefined) {
      const isCurrent = nodes.value.find(n => n.id === String(currentStepId));
      if (isCurrent) {
          setCenter(isCurrent.position.x + 175, isCurrent.position.y + 30, { zoom: 1.1, duration: 800 });
      } else {
          fitView({ padding: 0.2, duration: 800 });
      }
    }
  }, 50);
});

</script>

<template>
  <div class="w-full h-full bg-gray-900 relative">
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
      <Controls />
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
