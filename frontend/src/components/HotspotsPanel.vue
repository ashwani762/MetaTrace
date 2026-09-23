<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { templateFamilies, focusNode, selectedNodeId } from '../store';

const expanded = ref<Record<string, boolean>>({});
const maxSelf = computed(() => Math.max(1, ...templateFamilies.value.map(f => f.selfUs)));
const totalSelf = computed(() => templateFamilies.value.reduce((s, f) => s + f.selfUs, 0) || 1);
const totalInstances = computed(() => templateFamilies.value.reduce((s, f) => s + f.instances.length, 0));
const totalReuse = computed(() => templateFamilies.value.reduce((s, f) => s + f.memoHits, 0));

const fmt = (us: number) => us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : `${us} µs`;
const toggle = (base: string) => { expanded.value[base] = !expanded.value[base]; };
</script>

<template>
  <div data-tour="hotspots" class="h-full w-full bg-gray-950 text-gray-300 font-mono text-xs overflow-y-auto p-3">
    <div v-if="templateFamilies.length === 0" class="flex h-full items-center justify-center text-gray-600 italic text-sm">
      No trace data. Run "Build &amp; Trace" to see which templates cost the most.
    </div>

    <template v-else>
      <!-- Summary tiles -->
      <div class="grid grid-cols-3 gap-2 mb-3">
        <div class="rounded border border-gray-800 bg-gray-900/60 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-gray-500">Unique instantiations</div>
          <div class="text-lg text-gray-100">{{ totalInstances }}</div>
        </div>
        <div class="rounded border border-gray-800 bg-gray-900/60 px-3 py-2" title="Times Clang reused an already-instantiated specialization instead of instantiating it again">
          <div class="text-[10px] uppercase tracking-wider text-gray-500">Cache reuses</div>
          <div class="text-lg text-gray-100">{{ totalReuse }}</div>
        </div>
        <div class="rounded border border-gray-800 bg-gray-900/60 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-gray-500">Self time (sum)</div>
          <div class="text-lg text-gray-100">{{ fmt(totalSelf) }}</div>
        </div>
      </div>

      <table class="w-full text-left border-separate border-spacing-y-1">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider text-gray-500">
            <th class="font-normal px-2">Template</th>
            <th class="font-normal px-2 w-[38%]">Self time</th>
            <th class="font-normal px-2 text-right" title="Distinct specializations">Inst.</th>
            <th class="font-normal px-2 text-right" title="Re-uses of an existing specialization (memoization)">Reuse</th>
            <th class="font-normal px-2 text-right" title="Longest chain of the template instantiating itself">Recursion</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="fam in templateFamilies" :key="fam.base">
            <tr class="bg-gray-900/60 hover:bg-gray-800/70 cursor-pointer group" @click="toggle(fam.base)">
              <td class="px-2 py-1.5 rounded-l text-gray-100 truncate max-w-[14rem]" :title="fam.base">
                <span class="text-gray-500 inline-block w-3">{{ expanded[fam.base] ? '▾' : '▸' }}</span>
                {{ fam.base }}
                <span v-if="fam.failures" class="ml-1 text-red-300" :title="`${fam.failures} failed substitution(s)`">✖ {{ fam.failures }}</span>
              </td>
              <td class="px-2 py-1.5">
                <div class="flex items-center gap-2" :title="`${fmt(fam.selfUs)} · ${(100 * fam.selfUs / totalSelf).toFixed(1)}% of traced time`">
                  <div class="flex-1 h-2.5 bg-gray-800/60 rounded-sm overflow-hidden">
                    <div class="h-full bg-blue-500 rounded-r-[4px]" :style="{ width: (100 * fam.selfUs / maxSelf) + '%' }"></div>
                  </div>
                  <span class="w-16 text-right text-gray-400 tabular-nums">{{ fmt(fam.selfUs) }}</span>
                </div>
              </td>
              <td class="px-2 py-1.5 text-right tabular-nums">{{ fam.instances.length }}</td>
              <td class="px-2 py-1.5 text-right tabular-nums" :class="fam.memoHits ? 'text-gray-200' : 'text-gray-600'">{{ fam.memoHits }}</td>
              <td class="px-2 py-1.5 text-right tabular-nums rounded-r" :class="fam.maxRecursion > 1 ? 'text-gray-200' : 'text-gray-600'">{{ fam.maxRecursion > 1 ? fam.maxRecursion : '–' }}</td>
            </tr>

            <!-- Unrolled instances: shows how arguments evolve (e.g. N = 6 → 5 → 4 …) and the values they produce -->
            <tr v-if="expanded[fam.base]">
              <td colspan="5" class="px-2 pb-2">
                <div class="flex flex-wrap items-center gap-1 pl-4 pt-1">
                  <template v-for="(inst, i) in fam.instances" :key="inst.id">
                    <span v-if="i > 0" class="text-gray-600" aria-hidden="true">→</span>
                    <button
                      @click="focusNode(inst.id)"
                      class="rounded border px-2 py-0.5 text-left hover:border-blue-400 transition-colors"
                      :class="[
                        inst.failed ? 'border-red-600/60 bg-red-950/30' : 'border-gray-700 bg-gray-900',
                        selectedNodeId === String(inst.id) ? 'ring-1 ring-purple-400' : ''
                      ]"
                      :title="`${inst.name}\nself time: ${fmt(inst.selfUs)}`"
                    >
                      <span class="text-gray-200">&lt;{{ inst.args.join(', ') || '…' }}&gt;</span>
                      <span v-if="inst.value" class="ml-1 text-emerald-300">{{ inst.value }}</span>
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p class="text-[10px] text-gray-600 mt-2 px-1">
        Self time excludes time spent in nested instantiations. Click a row to unroll its specializations; click a specialization to find it in the graph.
      </p>
    </template>
  </div>
</template>
