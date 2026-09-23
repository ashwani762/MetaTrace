<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { ref } from 'vue';
import { overloadCalls, specializationChoices, focusNode, selectedNodeId } from '../store';
import ConstraintTree from './ConstraintTree.vue';

const openTrees = ref<Record<number, boolean>>({});

const REASONS: Record<string, string> = {
  conversion: 'needs a worse conversion',
  referenceBinding: 'worse reference binding',
  moreSpecialized: 'less specialized',
  moreConstrained: 'less constrained',
  nonTemplate: 'a non-template function won',
  notViable: 'arguments cannot bind',
  unknown: 'lost overload resolution'
};

const STATUS = {
  selected: { icon: '✔', label: 'Selected', cls: 'text-emerald-300 border-emerald-500/60 bg-emerald-950/40' },
  viable: { icon: '○', label: 'Viable, not chosen', cls: 'text-sky-300 border-sky-600/50 bg-sky-950/30' },
  rejected: { icon: '✖', label: 'Rejected (SFINAE)', cls: 'text-red-300 border-red-600/60 bg-red-950/40' },
  unsatisfied: { icon: '⊘', label: 'Constraints not satisfied', cls: 'text-amber-200 border-amber-600/60 bg-amber-950/30' },
  notViable: { icon: '✖', label: 'Not viable', cls: 'text-orange-200 border-orange-600/50 bg-orange-950/30' }
} as const;

const jumpToLine = (line: number) => {
  if (line) window.dispatchEvent(new CustomEvent('editor-highlight', { detail: { line, col: 1 } }));
};
</script>

<template>
  <div data-tour="overloads" class="h-full w-full bg-gray-950 text-gray-300 font-mono text-xs overflow-y-auto p-3 space-y-3">
    <div v-if="overloadCalls.length === 0 && specializationChoices.length === 0" class="flex h-full items-center justify-center text-gray-600 italic text-sm text-center px-6">
      No function-template overload resolution in this trace.
      Calls that deduce template arguments (e.g. <code class="mx-1 text-gray-400">process(5)</code>) appear here with every candidate and why it was kept or discarded.
    </div>

    <div v-for="call in overloadCalls" :key="call.key" class="rounded border border-gray-800 bg-gray-900/60">
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div class="text-gray-100">
          <span class="text-purple-300">{{ call.name }}(…)</span>
          <span class="text-gray-500 ml-2">call at</span>
          <button class="text-blue-400 hover:underline ml-1" @click="jumpToLine(call.line)">line {{ call.line }}:{{ call.col }}</button>
        </div>
        <div class="text-gray-500">
          {{ call.candidates.length }} candidate{{ call.candidates.length === 1 ? '' : 's' }}
          · {{ call.candidates.filter(c => c.status === 'rejected' || c.status === 'unsatisfied' || c.status === 'notViable').length }} discarded
        </div>
      </div>

      <ol class="p-2 space-y-1.5">
        <li
          v-for="cand in call.candidates"
          :key="cand.id"
          @click="focusNode(cand.id)"
          class="rounded border px-2.5 py-1.5 cursor-pointer transition-colors hover:brightness-125"
          :class="[STATUS[cand.status].cls, selectedNodeId === String(cand.id) ? 'ring-1 ring-purple-400' : '']"
        >
          <div class="flex items-center gap-2">
            <span class="w-4 text-center" aria-hidden="true">{{ STATUS[cand.status].icon }}</span>
            <span class="font-semibold">{{ STATUS[cand.status].label }}</span>
            <span class="text-gray-200 truncate" :title="cand.signature">{{ cand.signature }}</span>
            <button
              v-if="cand.declLine"
              class="ml-auto shrink-0 text-gray-400 hover:text-blue-300"
              title="Show this candidate's declaration"
              @click.stop="jumpToLine(cand.declLine)"
            >declared at line {{ cand.declLine }}</button>
          </div>
          <div v-if="cand.reason" class="ml-6 mt-1 text-[11px] whitespace-pre-wrap break-words" :class="cand.status === 'unsatisfied' ? 'text-amber-100/80' : 'text-red-200/80'">
            {{ cand.reason }}
          </div>
          <!-- Why a viable candidate lost: Clang's ranking rules applied to this call -->
          <div v-if="cand.ranking" class="ml-6 mt-1 text-[11px] text-sky-100/80">
            <span class="font-semibold">Lost because it is {{ REASONS[cand.ranking.reason] ?? cand.ranking.reason }}</span>
            <span class="text-gray-400"> vs {{ cand.ranking.winner }}</span>
            <ul class="mt-0.5 space-y-0.5 list-disc pl-4 text-gray-300">
              <li v-for="(d, i) in cand.ranking.details" :key="i" class="break-words">{{ d }}</li>
            </ul>
          </div>
          <div v-if="cand.constraints" class="ml-6 mt-1" @click.stop>
            <button class="text-[11px] text-cyan-300 hover:underline" @click="openTrees[cand.id] = !openTrees[cand.id]">
              {{ openTrees[cand.id] ? '▾' : '▸' }} constraint tree
            </button>
            <div v-if="openTrees[cand.id]" class="mt-1 rounded bg-gray-950/60 border border-gray-800 p-2">
              <ConstraintTree :node="cand.constraints" />
            </div>
          </div>
        </li>
      </ol>
    </div>

    <!-- Partial specialization matching -->
    <div v-if="specializationChoices.length > 0" class="rounded border border-gray-800 bg-gray-900/60">
      <div class="px-3 py-2 border-b border-gray-800 text-gray-100">
        Class template specialization
        <span class="text-gray-500 ml-2">which pattern each specialization matched</span>
      </div>
      <div class="p-2 space-y-2">
        <div v-for="spec in specializationChoices" :key="spec.id" class="rounded border border-gray-800 px-2.5 py-1.5">
          <button class="text-purple-300 hover:underline" @click="focusNode(spec.id)">{{ spec.name }}</button>
          <span class="text-gray-500 ml-2">requested at</span>
          <button class="text-blue-400 hover:underline ml-1" @click="jumpToLine(spec.line)">line {{ spec.line }}</button>
          <ul class="mt-1 ml-2 space-y-0.5">
            <li v-for="c in spec.candidates" :key="c.pattern + c.line" class="flex items-center gap-2" :class="c.chosen ? 'text-emerald-300' : 'text-gray-500'">
              <span class="w-4 text-center" aria-hidden="true">{{ c.chosen ? '✔' : '·' }}</span>
              <span>{{ c.pattern }}</span>
              <span v-if="c.chosen" class="text-[10px] uppercase tracking-wider">chosen</span>
              <button v-if="c.line" class="ml-auto text-gray-500 hover:text-blue-300" @click="jumpToLine(c.line)">line {{ c.line }}</button>
            </li>
          </ul>
        </div>
      </div>
      <p class="text-[10px] text-gray-600 px-3 pb-2">The most specialized pattern whose arguments can be deduced wins; the primary template is the fallback.</p>
    </div>

    <p v-if="overloadCalls.length > 0" class="text-[10px] text-gray-600 px-1">
      Only function-template candidates are traced; non-template overloads also take part in resolution but don't show up here.
    </p>
  </div>
</template>
