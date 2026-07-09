import { ref, computed, watch } from 'vue'

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

// Trace visualization state
export const traceSteps = ref<any[]>([]) // Flat list of time-travel steps (begin/end)
export const treeData = ref<any[]>([])   // Hierarchical representation of the template instantiations
export const currentStepIndex = ref(-1)  // Current position in the time-travel trace

// The ID of the currently selected/hovered node in the graph
export const selectedNodeId = ref<string | null>(null)

watch(currentStepIndex, () => {
  selectedNodeId.value = null;
});

export const activeStack = computed(() => {
  let targetIndex = currentStepIndex.value;
  if (selectedNodeId.value) {
    const idx = traceSteps.value.findIndex(s => s.id === selectedNodeId.value && s.type === 'begin');
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
  
  const vars = [];
  const name = current.name;
  const match = name.match(/^([^<]+)<(.+)>$/);
  
  if (!match) {
    vars.push({ name: 'Frame', value: name });
  } else {
    const argsStr = match[2];
    const args = [];
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

  // Only show computed values if we are returning (end step) or if they are already computed.
  // We can just show them on the 'end' step to simulate "returning".
  if (current.type === 'end' && current.values) {
    for (const key of Object.keys(current.values)) {
      vars.push({ name: `[return] ${key}`, value: current.values[key] });
    }
  }

  return vars;
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
  currentStepIndex.value = -1;
  selectedNodeId.value = null;
};

export const compileCode = async () => {
  isCompiling.value = true;
  errorMsg.value = '';
  compileOutput.value = '';
  traceSteps.value = [];
  treeData.value = [];
  currentStepIndex.value = -1;

  currentAbortController = new AbortController();

  try {
    const res = await fetch('http://localhost:3001/api/compile', {
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
        const { nodes, values } = data;
    
        // Deduplicate nodes globally by name (detail)
        const remap = new Map<number, number>();
        const firstSeen = new Map<string, any>();
        
        for (const node of nodes) {
          if (firstSeen.has(node.detail)) {
            const existing = firstSeen.get(node.detail);
            remap.set(node.id, existing.id);
            existing.dur += (node.dur || 0); // Accumulate duration
          } else {
            firstSeen.set(node.detail, node);
            remap.set(node.id, node.id);
          }
        }

        // Filter nodes down to unique ones and update their parentIds
        const uniqueNodes = nodes.filter((n: any) => remap.get(n.id) === n.id);
        for (const node of uniqueNodes) {
          if (node.parentId !== 0) {
            node.parentId = remap.get(node.parentId) || node.parentId;
          }
        }

        // Regenerate events via DFS to get clean enter/leave pairs
        const cleanEvents: any[] = [];
        const childrenMap = new Map<number, any[]>();
        for (const node of uniqueNodes) {
          if (!childrenMap.has(node.parentId)) childrenMap.set(node.parentId, []);
          childrenMap.get(node.parentId)!.push(node);
        }

        const dfs = (pid: number, depth: number = 0) => {
          const children = childrenMap.get(pid) || [];
          for (const child of children) {
            cleanEvents.push({ nodeId: child.id, type: 'Enter', depth });
            dfs(child.id, depth + 1);
            cleanEvents.push({ nodeId: child.id, type: 'Leave', depth });
          }
        };
        dfs(0);

        const steps: any[] = [];
        cleanEvents.forEach((event: any) => {
          const nodeObj = uniqueNodes.find((n: any) => n.id === event.nodeId);
          if (!nodeObj) return;

          const matchedValues: Record<string, string> = {};
          const prefix = nodeObj.detail + '::';
          for (const [k, v] of Object.entries(values || {})) {
            if (k.startsWith(prefix)) {
              matchedValues[k.replace(prefix, '')] = v as string;
            }
          }

          steps.push({ 
            type: event.type === 'Enter' ? 'begin' : 'end', 
            id: event.nodeId, 
            name: nodeObj.detail, 
            depth: event.depth, 
            values: matchedValues, 
            line: nodeObj.line, 
            col: nodeObj.col 
          });
        });

        // Rebuild treeData from uniqueNodes
        const treeMap = new Map();
        for (const n of uniqueNodes) {
          treeMap.set(n.id, {
            id: n.id,
            name: n.detail,
            ts: n.ts,
            dur: n.dur,
            line: n.line,
            col: n.col,
            children: [],
            values: steps.find(s => s.id === n.id)?.values || {}
          });
        }

        const tree: any[] = [];
        for (const n of uniqueNodes) {
          if (n.parentId === 0) {
            tree.push(treeMap.get(n.id));
          } else if (treeMap.has(n.parentId)) {
            treeMap.get(n.parentId).children.push(treeMap.get(n.id));
          }
        }

        traceSteps.value = steps;
        treeData.value = tree;
        currentStepIndex.value = -1;
        
        // Store values in a global map for Variables panel if needed
        (window as any).__TRACE_VALUES__ = data.values || {};
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
