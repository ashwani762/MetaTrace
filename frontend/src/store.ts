// Copyright (c) 2026 MetaTrace Contributors
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import { ref, computed, watch, nextTick } from 'vue'
import { isDeduction, splitTemplateName, prettyName, isNoise } from './kinds'

export const code = ref(`// ===========================================================
// Factorial Example
// ===========================================================

template <int N>
struct Factorial : Factorial<N - 1> {
    static constexpr int value = N * Factorial<N - 1>::value;
};

template <>
struct Factorial<0> {
    static constexpr int value = 1;
};

int main() {
    constexpr int result = Factorial<5>::value;
    return 0;
}
`)

// State flags
export const standard = ref('c++17') // C++ standard (e.g. c++17, c++20)
export const isCompiling = ref(false)
export const errorMsg = ref('')
export const compileOutput = ref('')
export const globalValues = ref<Record<string, string>>({})

// Trace visualization state
export const traceSteps = ref<any[]>([]) // Flat list of time-travel steps (begin/end)
export const treeData = ref<any[]>([])   // Hierarchical representation of the template instantiations
export const currentStepIndex = ref(-1)  // Current position in the time-travel trace
// Requests for specializations that already existed (memoized), as edges requester -> existing node
export const traceReuses = ref<{ sourceId: number, targetId: number, line: number, col: number }[]>([])

// The ID of the currently selected/hovered node in the graph
export const selectedNodeId = ref<string | null>(null)

watch(currentStepIndex, () => {
  selectedNodeId.value = null;
});

export const activeStack = computed(() => {
  let targetIndex = currentStepIndex.value;
  if (selectedNodeId.value) {
    // Find the step corresponding to the selected node
    const idx = traceSteps.value.findIndex(s => String(s.id) === String(selectedNodeId.value) && s.type === 'begin');
    if (idx >= 0) targetIndex = idx;
  }

  if (targetIndex < 0 || traceSteps.value.length === 0) return [];
  const stack = [];
  const activeIds = new Set();
  for (let i = 0; i <= targetIndex; i++) {
    const step = traceSteps.value[i];
    if (step.type === 'begin') {
      stack.push(step);
      activeIds.add(step.id);
    } else if (step.type === 'end') {
      if (i === targetIndex) {
        // Keep it on the stack so we can inspect its return values!
        // We will just replace it with the 'end' step so we know it's leaving
        stack.pop();
        stack.push(step);
      } else {
        stack.pop();
        activeIds.delete(step.id);
      }
    }
  }
  return stack.reverse(); // Top of stack first
});

export const activeVariables = computed(() => {
  const stack = activeStack.value;
  if (stack.length === 0) return [];
  const current = stack[0];
  const parent = stack.length > 1 ? stack[1] : null;

  const parseArgs = (name: string) => {
    if (!name.endsWith('>')) return null;
    
    let depth = 0;
    let matchIndex = -1;
    for (let i = name.length - 1; i >= 0; i--) {
      if (name[i] === '>') depth++;
      else if (name[i] === '<') {
        depth--;
        if (depth === 0) {
          matchIndex = i;
          break;
        }
      }
    }
    
    if (matchIndex === -1) return null;
    
    const base = name.substring(0, matchIndex).trim();
    const argsStr = name.substring(matchIndex + 1, name.length - 1);
    const args = [];
    depth = 0;
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
    return { base, args };
  };

  const vars = [];
  const currParsed = parseArgs(current.name);
  const parentParsed = parent ? parseArgs(parent.name) : null;

  if (!currParsed) {
    vars.push({ name: 'Frame', value: current.name, changed: false });
  } else {
    currParsed.args.forEach((arg, idx) => {
      let changed = false;
      if (parentParsed && parentParsed.base === currParsed.base) {
        if (idx >= parentParsed.args.length || parentParsed.args[idx] !== arg) {
          changed = true;
        }
      }
      vars.push({ name: `Arg ${idx + 1}`, value: arg, changed });
    });
  }

  if (current.type === 'end' && current.values) {
    for (const key of Object.keys(current.values)) {
      vars.push({ name: `[return] ${key}`, value: current.values[key], changed: false });
    }
  }

  return vars;
});

export const activeTypeAliases = computed(() => {
  const stack = activeStack.value;
  if (stack.length === 0) return [];
  const current = stack[0];
  const aliases = [];

  // If the current node is a TypeAlias template instantiation, show its specific desugaring!
  if (current.isAlias) {
    const val = globalValues.value[current.name];
    if (val) {
      aliases.push({ name: current.name, value: val });
    }
  }
  return aliases;
});

export const activeLocation = computed(() => {
  const stack = activeStack.value;
  if (stack.length === 0) return undefined;
  const current = stack[0];
  if (current.line && current.col) {
    return { line: current.line, col: current.col };
  }
  return undefined;
});

export const activeExplanation = computed(() => {
  if (currentStepIndex.value < 0 || traceSteps.value.length === 0) {
    return "Ready to trace.";
  }
  const step = traceSteps.value[currentStepIndex.value];
  if (!step) return "";

  if (step.type === 'begin') {
    return `Evaluating \`${step.name}\``;
  } else if (step.type === 'end') {
    if (step.values && Object.keys(step.values).length > 0) {
      const vals = Object.entries(step.values).map(([k, v]) => `${k} = ${v}`).join(', ');
      return `Completed \`${step.name}\` ➔ ${vals}`;
    } else {
      return `Completed \`${step.name}\``;
    }
  }
  return "";
});

export const setStepIndex = (index: number) => {
  if (index >= -1 && index < traceSteps.value.length) {
    currentStepIndex.value = index;
  }
};
let currentAbortController: AbortController | null = null;

export const stopCompile = () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
};

export const resetVisualizer = () => {
  stopCompile();
  isCompiling.value = false;
  errorMsg.value = '';
  compileOutput.value = '';
  traceSteps.value = [];
  treeData.value = [];
  traceReuses.value = [];
  currentStepIndex.value = -1;
  selectedNodeId.value = null;
};

const normalizeKeys = (obj: Record<string, any>) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) out[prettyName(k)] = typeof v === 'string' ? prettyName(v) : v;
  return out;
};

/**
 * Turns the plugin's raw trace into deduplicated time-travel steps and a causal tree.
 * Linear in the number of nodes so large production traces stay responsive.
 */
function ingestTrace(data: any) {
  const nodes: any[] = (data.nodes || []).map((n: any) => ({ ...n, detail: prettyName(n.detail), failReason: n.failReason && prettyName(n.failReason) }));
  const values = normalizeKeys(data.values || {});
  const memoHits = normalizeKeys(data.memoHits || {});

  // Clang often enters the same context more than once (e.g. declaration then definition).
  // Merge those repeats, but only when they share the same kind, template and (remapped)
  // parent: two overload candidates that both deduce `f<int>` must stay separate.
  const remap = new Map<number, number>();
  const firstSeen = new Map<string, any>();
  for (const node of nodes) {
    const parent = node.parentId === 0 ? 0 : (remap.get(node.parentId) ?? node.parentId);
    const key = `${node.detail}|${node.kindName ?? node.kind}|${node.declLine ?? 0}|${parent}`;
    const existing = firstSeen.get(key);
    if (existing) {
      remap.set(node.id, existing.id);
      existing.dur += (node.dur || 0);
      if (node.failed) {
        existing.failed = true;
        existing.failReason = node.failReason;
        existing.failKind = node.failKind;
      }
      if (node.desugaredCode) existing.desugaredCode = node.desugaredCode;
      if (node.specCandidates) existing.specCandidates = node.specCandidates;
    } else {
      firstSeen.set(key, node);
      remap.set(node.id, node.id);
    }
  }

  const uniqueNodes = nodes.filter(n => remap.get(n.id) === n.id);
  const byId = new Map<number, any>();
  const firstInstantiation = new Map<string, any>(); // detail -> first real instantiation
  for (const node of uniqueNodes) {
    if (node.parentId !== 0) node.parentId = remap.get(node.parentId) ?? node.parentId;
    byId.set(node.id, node);
    node.memoHits = 0;
    if (node.kindName === 'TemplateInstantiation' && !firstInstantiation.has(node.detail)) {
      firstInstantiation.set(node.detail, node);
      node.memoHits = memoHits[node.detail] || 0;
    }
  }

  // Constexpr results (e.g. `Fib<6>::value = 8`) keyed by owning specialization
  const valuesByOwner = new Map<string, Record<string, string>>();
  for (const [k, v] of Object.entries(values)) {
    const sep = k.lastIndexOf('::');
    if (sep <= 0) continue;
    const owner = k.slice(0, sep);
    if (!valuesByOwner.has(owner)) valuesByOwner.set(owner, {});
    valuesByOwner.get(owner)![k.slice(sep + 2)] = v as string;
  }

  const childrenMap = new Map<number, any[]>();
  for (const node of uniqueNodes) {
    if (!childrenMap.has(node.parentId)) childrenMap.set(node.parentId, []);
    childrenMap.get(node.parentId)!.push(node);
  }

  const toTreeNode = (n: any) => ({
    id: n.id,
    name: n.detail,
    ts: n.ts,
    dur: n.dur,
    line: n.line,
    col: n.col,
    failed: n.failed,
    failReason: n.failReason,
    failKind: n.failKind,
    isAlias: n.isAlias,
    kind: n.kind,
    kindName: n.kindName,
    entityKind: n.entityKind,
    internal: n.internal,
    declLine: n.declLine,
    memoHits: n.memoHits,
    specCandidates: n.specCandidates,
    desugaredCode: n.desugaredCode,
    values: valuesByOwner.get(n.detail) || {},
    children: [] as any[]
  });

  // DFS gives clean, properly nested begin/end pairs for time travel
  const steps: any[] = [];
  const tree: any[] = [];
  const stepFor = (t: any, type: 'begin' | 'end', depth: number) => ({
    type, id: t.id, name: t.name, depth, values: t.values, line: t.line, col: t.col,
    failed: t.failed, failReason: t.failReason, failKind: t.failKind, isAlias: t.isAlias,
    kind: t.kind, kindName: t.kindName, entityKind: t.entityKind, declLine: t.declLine,
    memoHits: t.memoHits, desugaredCode: t.desugaredCode
  });
  const dfs = (pid: number, depth: number, into: any[]) => {
    for (const child of childrenMap.get(pid) || []) {
      const t = toTreeNode(child);
      into.push(t);
      steps.push(stepFor(t, 'begin', depth));
      dfs(child.id, depth + 1, t.children);
      steps.push(stepFor(t, 'end', depth));
    }
  };
  dfs(0, 0, tree);

  // Cache hits become "reused" edges from the requesting node to the existing specialization
  const reuses: { sourceId: number, targetId: number, line: number, col: number }[] = [];
  const seenReuse = new Set<string>();
  for (const r of data.reuses || []) {
    const sourceId = remap.get(r.parentId) ?? r.parentId;
    const target = firstInstantiation.get(prettyName(r.detail));
    if (!sourceId || !target || target.id === sourceId || !byId.has(sourceId)) continue;
    if (byId.get(target.id)?.parentId === sourceId) continue; // already a tree edge
    const key = `${sourceId}->${target.id}`;
    if (seenReuse.has(key)) continue;
    seenReuse.add(key);
    reuses.push({ sourceId, targetId: target.id, line: r.line, col: r.col });
  }

  return { steps, tree, reuses };
}

export const compileCode = async () => {
  isCompiling.value = true;
  errorMsg.value = '';
  compileOutput.value = '';
  traceSteps.value = [];
  treeData.value = [];
  currentStepIndex.value = -1;

  currentAbortController = new AbortController();

  try {
    const res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value, standard: standard.value }),
      signal: currentAbortController.signal
    });
    const data = await res.json();
    
    if (data.error) {
      compileOutput.value = data.error + ": " + (data.details || '');
    } else {
      let outputText = '';
      if (data.stderr) outputText += data.stderr + "\n";
      if (data.output) outputText += data.output + "\n";
      compileOutput.value = outputText.trim();
      
      if (!data.nodes || data.nodes.length === 0) {
        // If there's no nodes, compilation likely failed completely, but we show the output in the panel.
      } else {
        const { steps, tree, reuses } = ingestTrace(data);
        traceSteps.value = steps;
        treeData.value = tree;
        traceReuses.value = reuses;
        currentStepIndex.value = steps.length > 0 ? 0 : -1;

        // Store values in a global reactive ref for Variables/Types panels
        globalValues.value = normalizeKeys(data.values || {});
      }
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      compileOutput.value = "Compilation stopped by user.";
    } else {
      compileOutput.value = "Network error: " + e;
    }
  } finally {
    isCompiling.value = false;
    currentAbortController = null;
  }
}

export const logicalStepIndex = computed(() => {
  return currentStepIndex.value;
});

export const logicalMaxSteps = computed(() => {
  return traceSteps.value.length;
});

export const handleStep = (action: 'back' | 'in' | 'over' | 'out') => {
  if (traceSteps.value.length === 0) return;

  switch (action) {
    case 'back': {
      let prevIndex = currentStepIndex.value - 1;
      if (prevIndex >= 0) {
        currentStepIndex.value = prevIndex;
      } else {
        currentStepIndex.value = -1;
      }
      break;
    }
    case 'in': {
      let nextIndex = currentStepIndex.value + 1;
      if (nextIndex < traceSteps.value.length) {
        currentStepIndex.value = nextIndex;
      } else {
        currentStepIndex.value = traceSteps.value.length - 1;
      }
      break;
    }
    case 'out': {
      const current = traceSteps.value[currentStepIndex.value];
      if (current) {
        let targetDepth = current.depth;
        if (current.type === 'begin') targetDepth = current.depth - 1;
        
        let nextIndex = currentStepIndex.value;
        while (nextIndex < traceSteps.value.length - 1) {
          nextIndex++;
          const nextStep = traceSteps.value[nextIndex];
          if (nextStep.type === 'end' && nextStep.depth <= targetDepth) {
            currentStepIndex.value = nextIndex;
            break;
          }
        }
      }
      break;
    }
    case 'over': {
      const current = traceSteps.value[currentStepIndex.value];
      if (current) {
        let targetDepth = current.depth;
        
        let nextIndex = currentStepIndex.value;
        while (nextIndex < traceSteps.value.length - 1) {
          nextIndex++;
          const nextStep = traceSteps.value[nextIndex];
          if (nextStep.type === 'end' && nextStep.depth <= targetDepth) {
            currentStepIndex.value = nextIndex;
            break;
          }
        }
      }
      break;
    }
  }
}
// ---------------------------------------------------------------------------
// Derived analytics used by the Overload Resolution, Template Hotspots and
// editor heat-map views. All are computed from the full (unscrubbed) trace.
// ---------------------------------------------------------------------------

export interface FlatNode {
  node: any;
  parent: any | null;
  depth: number;
}

/** Every node in the deduplicated tree, in DFS (instantiation) order. */
export const flatNodes = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (list: any[], parent: any | null, depth: number) => {
    for (const n of list) {
      out.push({ node: n, parent, depth });
      walk(n.children || [], n, depth + 1);
    }
  };
  walk(treeData.value, null, 0);
  return out;
});

/** Jump the timeline to where a node has completed and select it in every view. */
export const focusNode = async (id: number | string) => {
  const idx = traceSteps.value.findIndex(s => String(s.id) === String(id) && s.type === 'end');
  if (idx >= 0 && idx !== currentStepIndex.value) {
    currentStepIndex.value = idx;
    await nextTick(); // let the step-change watcher clear the old selection first
  }
  selectedNodeId.value = String(id);
  const step = traceSteps.value[idx];
  if (step?.line && step?.col) {
    window.dispatchEvent(new CustomEvent('editor-highlight', { detail: { line: step.line, col: step.col } }));
  }
};

export type CandidateStatus = 'selected' | 'viable' | 'rejected' | 'unsatisfied';

export interface OverloadCandidate {
  id: number;
  signature: string;
  declLine: number;
  status: CandidateStatus;
  reason?: string;
}

export interface OverloadCall {
  key: string;
  name: string;
  line: number;
  col: number;
  candidates: OverloadCandidate[];
  chosenId?: number;
}

/**
 * Groups argument-deduction attempts by call site. Each attempt is one function
 * template candidate; SFINAE rejections carry Clang's suppressed diagnostic.
 * Non-template overloads are not traced, so only template candidates appear.
 */
export const overloadCalls = computed<OverloadCall[]>(() => {
  const calls = new Map<string, OverloadCall>();
  const instantiations: any[] = [];

  for (const { node } of flatNodes.value) {
    if (node.kindName === 'TemplateInstantiation') instantiations.push(node);
    if (!isDeduction(node.kindName) || node.internal) continue;
    const { base } = splitTemplateName(node.name);
    const key = `${base}@${node.line}:${node.col}`;
    if (!calls.has(key)) calls.set(key, { key, name: base, line: node.line, col: node.col, candidates: [] });
    const candidate: OverloadCandidate = {
      id: node.id,
      signature: node.name,
      declLine: node.declLine || 0,
      status: node.failed ? (node.failKind === 'constraints' ? 'unsatisfied' : 'rejected') : 'viable',
      reason: node.failed ? node.failReason : undefined
    };
    // Explicit-argument substitution and deduction are two phases of the same candidate
    const list = calls.get(key)!.candidates;
    const same = candidate.declLine ? list.find(c => c.declLine === candidate.declLine) : undefined;
    if (!same) {
      list.push(candidate);
    } else {
      if (candidate.signature.length > same.signature.length) same.signature = candidate.signature;
      if (candidate.status !== 'viable') {
        same.status = candidate.status;
        same.reason = candidate.reason;
        same.id = candidate.id;
      }
    }
  }

  for (const call of calls.values()) {
    // The winner is the specialization whose definition gets instantiated at this call site
    const chosen = instantiations.find(n =>
      n.line === call.line && n.col === call.col && splitTemplateName(n.name).base === call.name);
    let winner = chosen ? call.candidates.find(c => c.status === 'viable' && c.declLine === chosen.declLine) : undefined;
    const viable = call.candidates.filter(c => c.status === 'viable');
    // Already-instantiated specializations are not re-instantiated; fall back to the only viable one
    if (!winner && viable.length === 1) winner = viable[0];
    if (winner) {
      winner.status = 'selected';
      call.chosenId = chosen?.id ?? winner.id;
    }
  }

  return [...calls.values()].sort((a, b) => a.line - b.line || a.col - b.col);
});

export interface SpecializationChoice {
  id: number;
  name: string;
  line: number;
  candidates: { pattern: string; line: number; chosen: boolean }[];
}

/** Class templates with partial specializations: which pattern each specialization matched. */
export const specializationChoices = computed<SpecializationChoice[]>(() => {
  const seen = new Set<string>();
  const out: SpecializationChoice[] = [];
  for (const { node } of flatNodes.value) {
    if (!node.specCandidates || seen.has(node.name)) continue;
    if (!node.specCandidates.some((c: any) => c.line > 0)) continue; // only templates the user wrote
    seen.add(node.name);
    out.push({ id: node.id, name: node.name, line: node.line, candidates: node.specCandidates });
  }
  return out;
});

export interface TemplateInstance {
  id: number;
  name: string;
  args: string[];
  value?: string;
  selfUs: number;
  failed: boolean;
}

export interface TemplateFamily {
  base: string;
  instances: TemplateInstance[];
  memoHits: number;
  selfUs: number;
  maxRecursion: number; // Longest chain of this template instantiating itself
  failures: number;
}

/**
 * Aggregates instantiations by primary template ("Fib" for Fib<0>..Fib<6>),
 * answering "which templates cost the most, and how deep does their recursion go?"
 */
export const templateFamilies = computed<TemplateFamily[]>(() => {
  const families = new Map<string, TemplateFamily>();
  const chainLen = new Map<any, number>();

  for (const { node, parent } of flatNodes.value) {
    if (node.kindName !== 'TemplateInstantiation' && node.kindName !== 'TypeAliasTemplateInstantiation') continue;
    const { base, args } = splitTemplateName(node.name);
    if (!families.has(base)) {
      families.set(base, { base, instances: [], memoHits: 0, selfUs: 0, maxRecursion: 0, failures: 0 });
    }
    const fam = families.get(base)!;

    const childTime = (node.children || []).reduce((s: number, c: any) => s + (c.dur || 0), 0);
    const selfUs = Math.max(0, (node.dur || 0) - childTime);

    const sameAsParent = parent && splitTemplateName(parent.name).base === base;
    const len = sameAsParent ? (chainLen.get(parent) ?? 1) + 1 : 1;
    chainLen.set(node, len);
    fam.maxRecursion = Math.max(fam.maxRecursion, len);

    fam.selfUs += selfUs;
    fam.memoHits += node.memoHits || 0;
    if (node.failed) fam.failures++;

    const existing = fam.instances.find(i => i.name === node.name);
    if (existing) {
      existing.selfUs += selfUs;
    } else {
      const valueKey = Object.keys(node.values || {})[0];
      fam.instances.push({
        id: node.id,
        name: node.name,
        args,
        value: valueKey ? `${valueKey} = ${node.values[valueKey]}` : undefined,
        selfUs,
        failed: !!node.failed
      });
    }
  }

  return [...families.values()].sort((a, b) => b.selfUs - a.selfUs);
});

export interface LineHeat {
  line: number;
  count: number;
  failures: number;
  selfUs: number;
  names: string[];
}

/** Per-source-line summary of instantiations triggered from that line. */
export const lineHeat = computed<LineHeat[]>(() => {
  const byLine = new Map<number, LineHeat>();
  for (const { node } of flatNodes.value) {
    if (!node.line) continue;
    if (!byLine.has(node.line)) byLine.set(node.line, { line: node.line, count: 0, failures: 0, selfUs: 0, names: [] });
    const h = byLine.get(node.line)!;
    h.count++;
    if (node.failed) h.failures++;
    const childTime = (node.children || []).reduce((s: number, c: any) => s + (c.dur || 0), 0);
    h.selfUs += Math.max(0, (node.dur || 0) - childTime);
    if (!h.names.includes(node.name)) h.names.push(node.name);
  }
  return [...byLine.values()];
});

// ---------------------------------------------------------------------------
// Graph view model: filtering, collapsing and a layout that stays stable while
// stepping through time (only visibility changes per step, not positions).
// ---------------------------------------------------------------------------

export const graphOptions = ref({
  simple: true,       // Hide compiler bookkeeping steps
  hideStd: false,     // Hide templates not declared in the user's file
  showReuse: true,    // Draw "reused from cache" edges
});

export const collapsedIds = ref<Set<string>>(new Set());

export const toggleCollapse = (id: string) => {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  collapsedIds.value = next;
};

watch(treeData, () => { collapsedIds.value = new Set(); });

export interface VisibleNode {
  node: any;
  visParentId: string | null; // Nearest visible ancestor
  childCount: number;         // Visible children before collapsing
  hiddenCount: number;        // Visible descendants hidden by collapsing this node
}

const isFilteredOut = (n: any) => {
  const o = graphOptions.value;
  if (o.simple && isNoise(n)) return true;
  if (o.hideStd && !n.declLine && !n.failed) return true;
  return false;
};

/** Nodes that pass the current filters, each linked to its nearest visible ancestor. */
export const visibleGraph = computed(() => {
  const visible = new Map<string, VisibleNode>();
  const redirect = new Map<string, string | null>(); // any node id -> id shown in its place

  const walk = (list: any[], visParent: string | null, hiddenUnder: string | null) => {
    for (const n of list) {
      const id = String(n.id);
      if (hiddenUnder) {
        redirect.set(id, hiddenUnder);
        if (!isFilteredOut(n)) visible.get(hiddenUnder)!.hiddenCount++;
        walk(n.children || [], visParent, hiddenUnder);
        continue;
      }
      if (isFilteredOut(n)) {
        redirect.set(id, visParent);
        walk(n.children || [], visParent, null);
        continue;
      }
      visible.set(id, { node: n, visParentId: visParent, childCount: 0, hiddenCount: 0 });
      redirect.set(id, id);
      if (visParent) visible.get(visParent)!.childCount++;
      walk(n.children || [], id, collapsedIds.value.has(id) ? id : null);
    }
  };
  walk(treeData.value, null, null);
  return { visible, redirect };
});

/** Index of each node's begin/end step, for fast "has this happened yet?" checks. */
export const stepIndexById = computed(() => {
  const begin = new Map<string, number>();
  const end = new Map<string, number>();
  traceSteps.value.forEach((s, i) => {
    const id = String(s.id);
    if (s.type === 'begin') begin.set(id, i); else end.set(id, i);
  });
  return { begin, end };
});

export const collapseAll = () => {
  const ids = new Set<string>();
  for (const [id, v] of visibleGraph.value.visible) if (v.childCount > 0 && v.visParentId !== null) ids.add(id);
  collapsedIds.value = ids;
};
export const expandAll = () => { collapsedIds.value = new Set(); };

/** Tree node and parent lookup by id. */
export const nodeIndex = computed(() => {
  const byId = new Map<string, { node: any, parent: any | null, depth: number }>();
  for (const f of flatNodes.value) byId.set(String(f.node.id), f);
  return byId;
});

/** The node the Inspector explains: the selected node, else the one at the current step. */
export const inspectedNode = computed(() => {
  const id = selectedNodeId.value ?? (traceSteps.value[currentStepIndex.value]?.id != null ? String(traceSteps.value[currentStepIndex.value].id) : null);
  return id ? nodeIndex.value.get(id) ?? null : null;
});

// ---------------------------------------------------------------------------
// Playback: watch the compiler work step by step
// ---------------------------------------------------------------------------

export const isPlaying = ref(false);
export const playSpeed = ref(4); // steps per second
let playTimer: ReturnType<typeof setInterval> | null = null;

const stopTimer = () => {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
};

export const togglePlay = () => {
  if (isPlaying.value) {
    isPlaying.value = false;
    return;
  }
  if (traceSteps.value.length === 0) return;
  if (currentStepIndex.value >= traceSteps.value.length - 1) currentStepIndex.value = -1;
  isPlaying.value = true;
};

watch([isPlaying, playSpeed], ([playing, speed]) => {
  stopTimer();
  if (!playing) return;
  playTimer = setInterval(() => {
    if (currentStepIndex.value >= traceSteps.value.length - 1) {
      isPlaying.value = false;
      return;
    }
    currentStepIndex.value++;
  }, 1000 / speed);
});

watch(traceSteps, () => { isPlaying.value = false; });

// ---------------------------------------------------------------------------
// Compiler diagnostics parsed from the tool output
// ---------------------------------------------------------------------------

export interface Diagnostic {
  severity: 'error' | 'warning' | 'note';
  line: number;
  col: number;
  message: string;
  inMainFile: boolean;
  notes: Diagnostic[];
  nodeId?: number; // Graph node for "in instantiation of 'X' requested here" notes
}

const DIAG_RE = /^(.*?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;

export const diagnostics = computed<Diagnostic[]>(() => {
  const out: Diagnostic[] = [];
  const nameToNode = new Map<string, number>();
  for (const { node } of flatNodes.value) if (!nameToNode.has(node.name)) nameToNode.set(node.name, node.id);

  for (const raw of compileOutput.value.split(/\r?\n/)) {
    const m = raw.match(DIAG_RE);
    if (!m) continue;
    const file = m[1].replace(/\\/g, '/');
    const severity = m[4] === 'fatal error' ? 'error' : m[4] as Diagnostic['severity'];
    const d: Diagnostic = {
      severity,
      line: Number(m[2]),
      col: Number(m[3]),
      message: prettyName(m[5]),
      inMainFile: /(^|\/)input\.cpp$/.test(file),
      notes: []
    };
    const inst = d.message.match(/in instantiation of (?:template class|function template specialization|member function|static data member|default argument|requirement|variable template specialization) '([^']+)'/);
    if (inst) d.nodeId = nameToNode.get(inst[1]);
    if (severity === 'note' && out.length > 0) out[out.length - 1].notes.push(d);
    else out.push(d);
  }
  return out;
});

/** Compiler output with the long temporary path of the user's file shortened. */
export const prettyOutput = computed(() =>
  compileOutput.value.replace(/[^\s'"]*[\\/]input\.cpp/g, 'input.cpp'));

// ---------------------------------------------------------------------------
// Guided tour (shown automatically on a visitor's first session)
// ---------------------------------------------------------------------------

export const TOUR_DONE_KEY = 'metatrace.tourDone.v1';
export const tourOpen = ref(false);

export const maybeStartTour = () => {
  let done = false;
  try { done = localStorage.getItem(TOUR_DONE_KEY) === '1'; } catch { /* storage may be unavailable */ }
  if (!done) tourOpen.value = true;
};
