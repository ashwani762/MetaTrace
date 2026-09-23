<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, markRaw } from 'vue';
import { VueFlow, useVueFlow, Position, MarkerType } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/controls/dist/style.css';
import dagre from 'dagre';
import {
    selectedNodeId, focusNode, graphOptions, visibleGraph, stepIndexById,
    traceReuses, collapseAll, expandAll, toggleCollapse, code
} from '../store';
import { describeKind, isDeduction, splitTemplateName } from '../kinds';
import MetaNode from './MetaNode.vue';
import ReuseEdge from './ReuseEdge.vue';
import LaneNode from './LaneNode.vue';
import type { LaneNodeData } from './LaneNode.vue';
import type { MetaNodeData } from './MetaNode.vue';

const nodeTypes = { meta: markRaw(MetaNode), lane: markRaw(LaneNode) } as any;
const edgeTypes = { reuse: markRaw(ReuseEdge) } as any;

const NODE_WIDTH = 320;

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
    { label: 'Rejected candidate (SFINAE / constraints)', colors: THEME.failed },
    { label: 'Currently being instantiated', colors: THEME.normalCurrent },
    { label: 'In progress (waiting on children)', colors: THEME.normalActive },
    { label: 'Completed', colors: THEME.normalFinished },
    { label: 'Type alias', colors: THEME.aliasFinished },
    { label: 'Overload candidate / base case', colors: { bg: THEME.normalFinished.bg, border: THEME.normalFinished.border }, style: 'dashed' },
    { label: 'Reused from cache (no new instantiation)', colors: { bg: 'transparent', border: '#a78bfa' }, style: 'dotted' }
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

function phaseGroupOf(n: any): MetaNodeData['phaseGroup'] {
    if (n.kindName === 'ExplicitSpecialization') return 'base';
    if (isDeduction(n.kindName)) return 'deduce';
    if (n.entityKind === 'concept' || n.kindName === 'ConstraintsCheck') return 'concept';
    if (n.isAlias || n.kindName === 'TypeAliasTemplateInstantiation') return 'alias';
    if (n.kindName === 'TemplateInstantiation') return 'instantiate';
    return 'other';
}

function phaseLabelOf(n: any): string {
    if (n.kindName === 'ExplicitSpecialization') return 'base case';
    if (n.kindName === 'TemplateInstantiation') {
        return n.entityKind === 'function' ? 'function body' : n.entityKind === 'variable' ? 'variable' : 'class';
    }
    if (isDeduction(n.kindName)) return 'candidate';
    return describeKind(n.kindName)?.tag ?? 'step';
}

function resultOf(n: any): string | undefined {
    const entries = Object.entries(n.values || {});
    if (entries.length === 0) return undefined;
    return entries.slice(0, 2).map(([k, v]) => `${k} = ${v}`).join(', ');
}

/** Estimated card height; must match what MetaNode renders so the layout doesn't overlap. */
function cardHeight(d: MetaNodeData): number {
    let h = 16 + 20; // padding + header
    if (d.args.length) {
        const chars = d.args.slice(0, 4).reduce((s, a) => s + Math.min(a.length, 38) + 3, 0);
        h += 6 + 18 * Math.max(1, Math.ceil(chars / 40));
    }
    if (d.result || d.reuse || d.collapsed) h += 22;
    if (d.reason) h += 36;
    return h;
}

function buildNodeData(n: any, v: { childCount: number, hiddenCount: number }, collapsed: boolean): MetaNodeData {
    const { base, args } = splitTemplateName(n.name);
    return {
        label: n.name,
        base,
        args,
        phase: phaseLabelOf(n),
        phaseGroup: phaseGroupOf(n),
        result: resultOf(n),
        reason: n.failed ? (n.failReason || 'Substitution failure') : undefined,
        failKind: n.failKind,
        reuse: n.memoHits || 0,
        line: n.line,
        childCount: v.childCount,
        hiddenCount: v.hiddenCount,
        collapsed
    };
}

const LANE_HEIGHT = 44;
const LANE_GAP = 70;

interface Lane {
    id: string;
    roots: string[];
    data: LaneNodeData;
}

/**
 * Layout of every visible node, computed once per trace/filter change. Stepping through
 * time only reveals nodes, so nothing jumps around while you scrub.
 *
 * Top-level instantiations are grouped into swimlanes by the source line that triggered
 * them, and lanes are stacked in source order, so the graph reads top-to-bottom like the code.
 */
const layout = computed(() => {
    const { visible } = visibleGraph.value;
    const data = new Map<string, MetaNodeData>();
    const kids = new Map<string | null, string[]>();
    for (const [id, v] of visible) {
        data.set(id, buildNodeData(v.node, v, v.hiddenCount > 0));
        if (!kids.has(v.visParentId)) kids.set(v.visParentId, []);
        kids.get(v.visParentId)!.push(id);
    }

    // Group roots by triggering line
    const byLine = new Map<number, string[]>();
    for (const r of kids.get(null) || []) {
        const line = visible.get(r)!.node.line || 0;
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line)!.push(r);
    }
    const lines = [...byLine.keys()].sort((a, b) => (a || Infinity) - (b || Infinity));
    const sourceLines = code.value.split('\n');

    const positions = new Map<string, { x: number, y: number, h: number }>();
    const lanes: Lane[] = [];
    let yOffset = 0;

    for (const line of lines) {
        const roots = byLine.get(line)!;
        const laneId = `lane-${line}`;
        const g = new dagre.graphlib.Graph();
        g.setDefaultEdgeLabel(() => ({}));
        g.setGraph({ rankdir: 'TB', ranksep: 50, nodesep: 30 });
        g.setNode(laneId, { width: NODE_WIDTH + 80, height: LANE_HEIGHT });

        let count = 0, failures = 0;
        const stack = [...roots];
        for (const r of roots) g.setEdge(laneId, r);
        while (stack.length) {
            const id = stack.pop()!;
            count++;
            if (visible.get(id)!.node.failed) failures++;
            g.setNode(id, { width: NODE_WIDTH, height: cardHeight(data.get(id)!) });
            for (const c of kids.get(id) || []) {
                g.setEdge(id, c);
                stack.push(c);
            }
        }
        dagre.layout(g);

        let minX = Infinity, minY = Infinity, maxY = -Infinity;
        g.nodes().forEach(id => {
            const p = g.node(id);
            minX = Math.min(minX, p.x - p.width / 2);
            minY = Math.min(minY, p.y - p.height / 2);
            maxY = Math.max(maxY, p.y + p.height / 2);
        });
        g.nodes().forEach(id => {
            const p = g.node(id);
            positions.set(id, { x: p.x - p.width / 2 - minX, y: p.y - p.height / 2 - minY + yOffset, h: p.height });
        });
        // Pin the lane header to the lane's left edge so lanes line up like a document
        const header = positions.get(laneId)!;
        header.x = 0;

        lanes.push({
            id: laneId,
            roots,
            data: { line, source: line ? (sourceLines[line - 1] ?? '').trim() : '', count, failures }
        });
        yOffset += maxY - minY + LANE_GAP;
    }
    return { positions, data, lanes };
});

function findTreeNode(id: string) {
    return visibleGraph.value.visible.get(id)?.node ?? null;
}

/**
 * Builds the tooltip rows for a node: arguments, result values, phase, status and timing.
 */
function parseNodeVars(nodeData: any, nodeId: string) {
    const vars: { name: string, value: string }[] = [];
    const { base, args } = splitTemplateName(nodeData.name);
    vars.push({ name: 'Template', value: base });
    args.forEach((arg, idx) => vars.push({ name: `Arg ${idx + 1}`, value: arg }));

    for (const [k, val] of Object.entries(nodeData.values || {})) {
        vars.push({ name: `↪ ${k}`, value: String(val) });
    }

    const { begin, end } = stepIndexById.value;
    const endIdx = end.get(nodeId) ?? -1;
    const beginIdx = begin.get(nodeId) ?? -1;
    if (endIdx >= 0 && endIdx <= props.currentIndex) {
        vars.push({ name: 'Status', value: nodeData.failed ? '✖ Discarded' : '✅ Completed' });
    } else if (beginIdx >= 0 && beginIdx <= props.currentIndex) {
        vars.push({ name: 'Status', value: '⏳ In Progress' });
    }

    const kind = describeKind(nodeData.kindName);
    if (kind) vars.push({ name: 'Phase', value: kind.tag });
    if (nodeData.declLine) vars.push({ name: 'Declared at', value: `line ${nodeData.declLine}` });
    if (nodeData.memoHits) vars.push({ name: 'Reused', value: `${nodeData.memoHits}× from cache` });
    if (nodeData.dur !== undefined) vars.push({ name: 'Duration', value: `${(nodeData.dur / 1000).toFixed(3)} ms` });
    if (nodeData.failed) vars.push({ name: 'Error', value: nodeData.failReason || 'Unknown failure' });
    return vars;
}

const tooltipData = computed(() => {
    const id = tooltipPinned.value ? selectedNodeId.value : hoveredNodeId.value;
    if (!id) return null;
    const nodeData = findTreeNode(id);
    if (!nodeData) return null;
    return { name: nodeData.name, vars: parseNodeVars(nodeData, id) };
});

const onNodeClick = (event: any) => {
    const id = String(event.node.id);
    if (id.startsWith('lane-')) return;
    if (tooltipPinned.value && selectedNodeId.value === id) {
        tooltipPinned.value = false;
        selectedNodeId.value = null;
        hoveredNodeId.value = id;
        return;
    }
    selectedNodeId.value = id;
    tooltipPinned.value = true;
    hoveredNodeId.value = null;
    const nodeData = findTreeNode(id);
    if (nodeData?.line && nodeData?.col) {
        window.dispatchEvent(new CustomEvent('editor-highlight', {
            detail: { line: nodeData.line, col: nodeData.col }
        }));
    }
};

const onNodeDoubleClick = (event: any) => {
    if (String(event.node.id).startsWith('lane-')) return;
    toggleCollapse(String(event.node.id));
};

const onNodeMouseEnter = (event: any) => {
    if (tooltipPinned.value || String(event.node.id).startsWith('lane-')) return;
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
        const NODE_W   = NODE_WIDTH;
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


/** The node that stands in for the current step (itself, or its nearest visible ancestor). */
const currentVisibleId = computed(() => {
    const step = props.steps[props.currentIndex];
    if (!step) return null;
    return visibleGraph.value.redirect.get(String(step.id)) ?? null;
});

function styleFor(n: any, id: string, state: { active: boolean, current: boolean, selected: boolean }) {
    let bg = THEME.normalFinished.bg, border = THEME.normalFinished.border;
    let shadow = '0 1px 3px rgba(0,0,0,0.3)';
    let borderStyle = isDeduction(n.kindName) || n.kindName === 'ExplicitSpecialization' ? 'dashed' : 'solid';
    const alias = n.isAlias || n.kindName === 'TypeAliasTemplateInstantiation';

    if (state.selected) {
        bg = THEME.selected.bg; border = THEME.selected.border;
        shadow = '0 0 15px rgba(124, 58, 237, 0.5)';
    } else if (n.failed && !state.active) {
        bg = THEME.failed.bg; border = THEME.failed.border; borderStyle = 'dashed';
        shadow = '0 0 10px rgba(239, 68, 68, 0.35)';
    } else if (state.current) {
        const t = alias ? THEME.aliasCurrent : THEME.normalCurrent;
        bg = t.bg; border = t.border;
        shadow = alias ? '0 0 15px rgba(251, 146, 60, 0.5)' : '0 0 15px rgba(59, 130, 246, 0.5)';
    } else if (state.active) {
        const t = alias ? THEME.aliasActive : THEME.normalActive;
        bg = t.bg; border = t.border;
    } else if (alias) {
        bg = THEME.aliasFinished.bg; border = THEME.aliasFinished.border;
    }
    const pos = layout.value.positions.get(id)!;
    return {
        background: bg,
        color: '#fff',
        border: `2px ${borderStyle} ${border}`,
        borderRadius: '8px',
        padding: '0',
        width: `${NODE_WIDTH}px`,
        height: `${pos.h}px`,
        boxShadow: shadow,
        cursor: 'pointer',
        opacity: 1
    };
}

// Reveal nodes up to the current step on top of the precomputed layout
watch(
    () => [props.currentIndex, selectedNodeId.value, layout.value, graphOptions.value.showReuse, traceReuses.value] as const,
    ([idx, selected]) => {
        if (idx < 0 || !props.steps.length) {
            nodes.value = [];
            edges.value = [];
            return;
        }
        const { visible, redirect } = visibleGraph.value;
        const { begin, end } = stepIndexById.value;
        const current = currentVisibleId.value;

        const newNodes: any[] = [];
        const newEdges: any[] = [];
        const revealed = new Set<string>();

        for (const [id, v] of visible) {
            const b = begin.get(id) ?? Infinity;
            if (b > idx) continue;
            revealed.add(id);
            const e = end.get(id) ?? Infinity;
            const active = e > idx;
            const pos = layout.value.positions.get(id)!;
            newNodes.push({
                id,
                type: 'meta',
                position: { x: pos.x, y: pos.y },
                data: layout.value.data.get(id),
                style: styleFor(v.node, id, { active, current: id === current, selected: selected === id }),
                sourcePosition: Position.Bottom,
                targetPosition: Position.Top
            });
        }

        for (const lane of layout.value.lanes) {
            const shown = lane.roots.filter(r => revealed.has(r));
            if (shown.length === 0) continue;
            const pos = layout.value.positions.get(lane.id)!;
            newNodes.push({
                id: lane.id,
                type: 'lane',
                position: { x: pos.x, y: pos.y },
                data: lane.data,
                selectable: false,
                style: {
                    width: `${NODE_WIDTH + 80}px`,
                    height: `${LANE_HEIGHT}px`,
                    background: 'rgba(30, 41, 59, 0.55)',
                    border: '1px solid #334155',
                    borderLeft: '3px solid #60a5fa',
                    borderRadius: '6px',
                    padding: '0',
                    color: '#e5e7eb',
                    opacity: 1
                }
            });
            for (const r of shown) {
                newEdges.push({
                    id: `l-${lane.id}-${r}`,
                    source: lane.id,
                    target: r,
                    type: 'smoothstep',
                    style: { stroke: '#475569', strokeWidth: 1.5, strokeDasharray: '4 4', fill: 'none' },
                    data: { lane: true }
                });
            }
        }

        for (const [id, v] of visible) {
            if (!revealed.has(id) || !v.visParentId || !revealed.has(v.visParentId)) continue;
            const active = (end.get(id) ?? Infinity) > idx;
            const parent = visible.get(v.visParentId)!.node;
            newEdges.push({
                id: `e-${v.visParentId}-${id}`,
                source: v.visParentId,
                target: id,
                type: 'smoothstep',
                animated: active,
                label: isDeduction(parent.kindName) ? 'signature deduction' : '',
                labelBgStyle: { fill: '#1f2937' },
                labelStyle: { fill: '#9ca3af', fontSize: '10px', fontFamily: 'monospace' },
                style: { stroke: active ? '#60a5fa' : '#9ca3af', strokeWidth: 2.5, fill: 'none' },
                markerEnd: { type: MarkerType.ArrowClosed, color: active ? '#60a5fa' : '#9ca3af' },
                data: { tree: true }
            });
        }

        if (graphOptions.value.showReuse) {
            const seen = new Set<string>();
            for (const r of traceReuses.value) {
                const s = redirect.get(String(r.sourceId));
                const t = redirect.get(String(r.targetId));
                if (!s || !t || s === t || !revealed.has(s) || !revealed.has(t)) continue;
                const key = `${s}->${t}`;
                if (seen.has(key) || visible.get(t)?.visParentId === s) continue;
                seen.add(key);
                newEdges.push({
                    id: `r-${key}`,
                    source: s,
                    target: t,
                    sourceHandle: 'reuse-out',
                    targetHandle: 'reuse-in',
                    type: 'reuse',
                    label: 'reused',
                    labelBgStyle: { fill: '#1e1b4b' },
                    labelStyle: { fill: '#c4b5fd', fontSize: '10px', fontFamily: 'monospace' },
                    style: { stroke: '#a78bfa', strokeWidth: 1.5, strokeDasharray: '2 4', fill: 'none' },
                    markerEnd: { type: MarkerType.Arrow, color: '#a78bfa' },
                    data: { reuse: true }
                });
            }
        }

        nodes.value = newNodes;
        edges.value = newEdges;
    },
    { immediate: true }
);

function centerOnCurrentStep() {
    const id = currentVisibleId.value;
    const pos = id ? layout.value.positions.get(id) : undefined;
    if (pos) {
        setCenter(pos.x + NODE_WIDTH / 2, pos.y + pos.h / 2, { zoom: 1.1, duration: 600 });
    } else {
        fitView({ padding: 0.2, duration: 600 });
    }
}

onNodesInitialized(() => {
    centerOnCurrentStep();
});

function updateHighlights() {
    const targetId = hoveredNodeId.value || selectedNodeId.value;
    const treeEdges = edges.value.filter(e => e.data?.tree);
    if (!targetId) {
        nodes.value.forEach(n => { if (n.style) n.style.opacity = 1.0; });
        edges.value.forEach(e => { if (e.style) e.style.opacity = 1.0; });
        return;
    }

    // Highlight the causal chain: the node and every ancestor that led to it
    const path = new Set<string>();
    let curr: string | undefined = targetId;
    while (curr) {
        path.add(curr);
        curr = treeEdges.find(e => e.target === curr)?.source;
    }

    nodes.value.forEach(n => { if (n.style) n.style.opacity = path.has(n.id) || n.type === 'lane' ? 1.0 : 0.25; });
    edges.value.forEach(e => {
        if (!e.style) return;
        const inPath = e.data?.reuse ? e.source === targetId : path.has(e.source) && path.has(e.target);
        e.style.opacity = inPath ? 1.0 : 0.12;
    });
}

watch([hoveredNodeId, selectedNodeId, nodes], () => {
    updateHighlights();
});

watch(() => [props.currentIndex, props.tree], () => {
    // Only pan when stepping, not when selecting
    setTimeout(() => centerOnCurrentStep(), 50);
});

// Search: Enter cycles through nodes whose name matches
const searchQuery = ref('');
const searchMatches = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return [] as string[];
    const out: string[] = [];
    for (const [id, v] of visibleGraph.value.visible) if (v.node.name.toLowerCase().includes(q)) out.push(id);
    return out;
});
const searchCursor = ref(0);
watch(searchQuery, () => { searchCursor.value = 0; });
const gotoMatch = async () => {
    if (searchMatches.value.length === 0) return;
    const id = searchMatches.value[searchCursor.value % searchMatches.value.length];
    searchCursor.value++;
    await focusNode(id);
    tooltipPinned.value = true;
    const pos = layout.value.positions.get(id);
    if (pos) setCenter(pos.x + NODE_WIDTH / 2, pos.y + pos.h / 2, { zoom: 1.1, duration: 500 });
};

const hiddenByFilters = computed(() => {
    let total = 0;
    const walk = (list: any[]) => { for (const n of list) { total++; walk(n.children || []); } };
    walk(props.tree);
    return total - visibleGraph.value.visible.size;
});

const graphContainer = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
    if (graphContainer.value) {
        resizeObserver = new ResizeObserver(() => {
            setTimeout(() => centerOnCurrentStep(), 50);
        });
        resizeObserver.observe(graphContainer.value);
    }
});

const isLegendExpanded = ref(false);
const showViewMenu = ref(false);

onUnmounted(() => {
    if (resizeObserver) resizeObserver.disconnect();
});

</script>

<template>
  <div class="h-full w-full relative" ref="graphContainer">

    <!-- Top-Left: view menu and search -->
    <div data-tour="graph-toolbar" class="absolute top-2 left-2 z-10 flex items-center gap-1.5 text-xs">
        <div class="relative">
            <button class="graph-toggle" @click="showViewMenu = !showViewMenu" :aria-expanded="showViewMenu">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M6 12h12M10 20h4"/></svg>
                View
                <span v-if="hiddenByFilters > 0" class="text-gray-500">· {{ hiddenByFilters }} hidden</span>
                <span class="text-gray-500">▾</span>
            </button>
            <div v-if="showViewMenu" class="fixed inset-0 z-10" @click="showViewMenu = false"></div>
            <div v-if="showViewMenu" class="absolute left-0 top-full mt-1 z-20 w-64 bg-gray-800 border border-gray-700 rounded shadow-xl p-1.5 text-gray-200">
                <label class="view-item" title="Hide compiler bookkeeping (parameter mapping, constraint normalization, internal checks). Failures are always shown.">
                    <input type="checkbox" v-model="graphOptions.simple" />
                    <span>Simple view <span class="block text-[10px] text-gray-500">Hide compiler bookkeeping steps</span></span>
                </label>
                <label class="view-item">
                    <input type="checkbox" v-model="graphOptions.hideStd" />
                    <span>Hide std internals <span class="block text-[10px] text-gray-500">Only templates declared in your code</span></span>
                </label>
                <label class="view-item">
                    <input type="checkbox" v-model="graphOptions.showReuse" />
                    <span>Reuse edges <span class="block text-[10px] text-gray-500">Dotted ♻ arcs for cache hits</span></span>
                </label>
                <div class="border-t border-gray-700 my-1"></div>
                <button class="view-item w-full" @click="collapseAll(); showViewMenu = false">Collapse all subtrees</button>
                <button class="view-item w-full" @click="expandAll(); showViewMenu = false">Expand all</button>
            </div>
        </div>
        <div class="flex items-center bg-gray-800/90 border border-gray-700 rounded">
            <svg class="w-3.5 h-3.5 ml-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"/></svg>
            <input
                v-model="searchQuery"
                @keydown.enter="gotoMatch"
                placeholder="Find template…"
                class="bg-transparent px-2 py-1 w-40 text-gray-200 outline-none placeholder:text-gray-500"
            />
            <span v-if="searchQuery" class="px-1.5 text-gray-500 tabular-nums">{{ searchMatches.length }}</span>
        </div>
    </div>

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
    <div class="absolute bottom-4 right-4 z-10">
        <div class="mt-4 bg-gray-900/80 p-3 rounded-lg border border-gray-700 shadow-xl backdrop-blur-sm max-w-sm pointer-events-auto transition-all duration-300">
            <h3 @click="isLegendExpanded = !isLegendExpanded" class="text-sm font-bold text-gray-300 flex items-center justify-between cursor-pointer hover:text-white group" :class="{ 'mb-1 border-b border-gray-700 pb-1': isLegendExpanded, 'mb-0': !isLegendExpanded }">
                <div class="flex items-center">
                    <svg class="w-4 h-4 mr-1.5 text-gray-400 group-hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Legend
                </div>
                <svg class="w-4 h-4 text-gray-500 transition-transform duration-200" :class="{ 'rotate-180': isLegendExpanded }" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </h3>
            <div v-show="isLegendExpanded" class="grid grid-cols-1 gap-1.5 mt-2">
                <div v-for="(item, idx) in LEGEND_ITEMS" :key="idx" class="flex items-center text-xs text-gray-300">
                    <div class="w-4 h-4 rounded-sm mr-2 flex-shrink-0" :style="{
                        background: item.colors.bg,
                        border: `2px ${item.style || 'solid'} ${item.colors.border}`
                    }"></div>
                    {{ item.label }}
                </div>
                <div class="text-[11px] text-gray-500 mt-1 leading-snug">
                    Badges: <span class="text-blue-300">class / function body</span> = instantiated,
                    <span class="text-violet-300">candidate</span> = overload being tried,
                    <span class="text-cyan-300">concept check</span>,
                    <span class="text-emerald-300">base case</span> = explicit specialization.
                    Double-click a node to collapse it.
                </div>
            </div>
        </div>
    </div>

    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      @node-click="onNodeClick"
      @node-double-click="onNodeDoubleClick"
      @node-mouse-enter="onNodeMouseEnter"
      @node-mouse-leave="onNodeMouseLeave"
      @pane-click="onPaneClick"
      class="vue-flow-dark"
      :default-viewport="{ zoom: 1 }"
      :min-zoom="0.05"
      :max-zoom="4"
      :nodes-draggable="false"
      :zoom-on-double-click="false"
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
          top: tooltipPinned ? '44px' : (tooltipPos.y - 20) + 'px',
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
.graph-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(31, 41, 55, 0.9);
  border: 1px solid #374151;
  color: #d1d5db;
  cursor: pointer;
  user-select: none;
}
.graph-toggle:hover { background: #374151; }
.graph-toggle input { accent-color: #3b82f6; }
.view-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}
.view-item:hover { background: #374151; }
.view-item input { margin-top: 2px; accent-color: #3b82f6; }
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
