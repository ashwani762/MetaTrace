<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { computed } from 'vue';
import { inspectedNode, nodeIndex, code, focusNode, currentStepIndex, stepIndexById, traceRankings } from '../store';
import ConstraintTree from './ConstraintTree.vue';
import { describeKind, isDeduction, splitTemplateName } from '../kinds';

const sourceLines = computed(() => code.value.split('\n'));
const sourceAt = (line?: number) => (line ? (sourceLines.value[line - 1] ?? '').trim() : '');

const RANKING_TEXT: Record<string, string> = {
  conversion: 'The chosen candidate needs a better (cheaper) conversion for at least one argument.',
  referenceBinding: 'Same conversions, but the chosen candidate binds an rvalue argument to an rvalue reference, which is preferred.',
  moreSpecialized: 'Both match equally well; partial ordering picked the more specialized template.',
  moreConstrained: 'Both match equally well and neither is more specialized; the chosen template is more constrained.',
  nonTemplate: 'A non-template function that matches equally well is preferred over a template.',
  notViable: 'The deduced signature cannot accept these arguments (for example an lvalue passed to T&&).',
  unknown: 'Clang ranked another candidate higher.'
};

const fmt = (us: number) => us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : `${Math.round(us)} µs`;

const jumpToLine = (line?: number) => {
  if (line) window.dispatchEvent(new CustomEvent('editor-highlight', { detail: { line, col: 1 } }));
};

const info = computed(() => {
  const entry = inspectedNode.value;
  if (!entry) return null;
  const n = entry.node;
  const { base, args } = splitTemplateName(n.name);
  const where = n.declLine ? `declared at line ${n.declLine}` : 'declared in a library header';
  const at = n.line ? `line ${n.line}:${n.col}` : 'an implicit location';

  // One plain-English sentence for what the compiler did here
  let headline = '';
  let kindLabel = describeKind(n.kindName)?.tag ?? n.kindName;
  if (n.kindName === 'ExplicitSpecialization') {
    kindLabel = 'base case';
    headline = `Used the hand-written explicit specialization ${n.name} (${where}). Nothing had to be generated, so recursion that reaches it stops here.`;
  } else if (n.kindName === 'TemplateInstantiation') {
    const what = n.entityKind === 'function' ? 'the body of function' : n.entityKind === 'variable' ? 'the variable' : 'the class';
    kindLabel = n.entityKind === 'function' ? 'function body' : n.entityKind === 'variable' ? 'variable' : 'class';
    headline = `Generated ${what} ${n.name} from the template ${base} (${where}), because it was needed at ${at}.`;
  } else if (isDeduction(n.kindName)) {
    kindLabel = 'overload candidate';
    headline = `Tried ${base} (${where}) as a candidate for the call at ${at}, deducing ${args.length ? args.join(', ') : 'its template arguments'} and substituting them into the signature.`;
  } else if (n.kindName === 'ConstraintsCheck') {
    headline = n.entityKind === 'concept'
      ? `Checked whether the concept ${n.name} is satisfied.`
      : `Checked the requires-clause / constraints of ${base}.`;
  } else if (n.kindName === 'TypeAliasTemplateInstantiation') {
    headline = `Substituted into the alias template ${n.name} to compute a type.`;
  } else {
    headline = describeKind(n.kindName)?.explanation ?? `Compiler step ${n.kindName}.`;
  }

  let outcome: { tone: 'ok' | 'fail' | 'warn', text: string } | null = null;
  if (n.failed) {
    outcome = n.failKind === 'constraints'
      ? { tone: 'warn', text: `Discarded: ${n.failReason}` }
      : { tone: 'fail', text: isDeduction(n.kindName) || n.failKind === 'sfinae'
          ? `Discarded without an error (SFINAE): ${n.failReason}`
          : `Failed: ${n.failReason}` };
  } else if (isDeduction(n.kindName)) {
    outcome = { tone: 'ok', text: 'Substitution succeeded; this candidate stayed viable for overload resolution.' };
  }

  // If it was viable but another candidate won, Clang's ranking explains why
  const ranking = isDeduction(n.kindName) && !n.failed
    ? traceRankings.value.find(r => r.line === n.line && r.col === n.col && r.loserDeclLine === n.declLine)
    : undefined;
  if (ranking) {
    outcome = ranking.reason === 'notViable'
      ? { tone: 'fail', text: 'Deduction succeeded, but the arguments cannot bind to its parameters, so it is not viable.' }
      : { tone: 'warn', text: `Viable, but ${ranking.winner} was chosen instead.` };
  }

  // Why is this here? Walk up the causal chain to the code that started it
  const chain: any[] = [];
  let cur: any = entry;
  while (cur) {
    chain.unshift(cur.node);
    cur = cur.parent ? nodeIndex.value.get(String(cur.parent.id)) : null;
  }

  // Arguments, marking which ones changed relative to a parent of the same template (recursion)
  const parent = entry.parent;
  const parentSplit = parent ? splitTemplateName(parent.name) : null;
  const argRows = args.map((a, i) => ({
    index: i + 1,
    value: a,
    changed: !!parentSplit && parentSplit.base === base && parentSplit.args[i] !== a,
    from: parentSplit && parentSplit.base === base ? parentSplit.args[i] : undefined
  }));

  const childTime = (n.children || []).reduce((s: number, c: any) => s + (c.dur || 0), 0);
  const { end } = stepIndexById.value;
  const finished = (end.get(String(n.id)) ?? Infinity) <= currentStepIndex.value;

  return {
    n, base, kindLabel, headline, outcome, chain, argRows, finished,
    values: Object.entries({ ...(n.results || {}), ...(n.values || {}) }),
    ranking,
    children: n.children || [],
    selfUs: Math.max(0, (n.dur || 0) - childTime),
    totalUs: n.dur || 0
  };
});
</script>

<template>
  <div data-tour="inspector" class="h-full w-full bg-gray-950 text-gray-300 text-xs overflow-y-auto p-3 font-sans">
    <div v-if="!info" class="flex h-full items-center justify-center text-gray-600 italic text-sm text-center px-6">
      Select a node in the graph (or step through the trace) to see what the compiler did there and why.
    </div>

    <div v-else class="space-y-3">
      <!-- Header -->
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[10px] uppercase tracking-wider text-gray-400 border border-gray-600 rounded px-1.5">{{ info.kindLabel }}</span>
          <span class="font-mono text-sm text-gray-100 break-all">{{ info.n.name }}</span>
          <span v-if="!info.finished" class="text-[10px] text-blue-300">⏳ in progress at this step</span>
        </div>
        <p class="mt-2 text-[13px] leading-relaxed text-gray-200">{{ info.headline }}</p>
        <div v-if="info.outcome" class="mt-2 rounded border px-2.5 py-1.5 font-mono text-[11px] leading-relaxed"
          :class="{
            'border-red-700/60 bg-red-950/40 text-red-200': info.outcome.tone === 'fail',
            'border-amber-700/60 bg-amber-950/30 text-amber-100': info.outcome.tone === 'warn',
            'border-emerald-800/60 bg-emerald-950/30 text-emerald-200': info.outcome.tone === 'ok'
          }">
          {{ info.outcome.tone === 'ok' ? '✔' : info.outcome.tone === 'warn' ? '⊘' : '✖' }} {{ info.outcome.text }}
        </div>
      </div>

      <!-- Why is this here? -->
      <section>
        <h3 class="section-title">Why is this here?</h3>
        <ol class="space-y-1">
          <li v-for="(step, i) in info.chain" :key="step.id" class="flex gap-2">
            <span class="text-gray-600 w-4 text-right shrink-0">{{ i + 1 }}</span>
            <div class="min-w-0">
              <button class="font-mono text-left hover:underline break-all" :class="i === info.chain.length - 1 ? 'text-purple-300' : 'text-gray-300'" @click="focusNode(step.id)">{{ step.name }}</button>
              <div v-if="step.line" class="text-gray-500">
                needed at
                <button class="text-blue-400 hover:underline" @click="jumpToLine(step.line)">line {{ step.line }}</button>
                <code v-if="sourceAt(step.line)" class="ml-1 text-gray-400 break-all">{{ sourceAt(step.line) }}</code>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <!-- Arguments -->
      <section v-if="info.argRows.length">
        <h3 class="section-title">Template arguments</h3>
        <table class="w-full font-mono">
          <tr v-for="a in info.argRows" :key="a.index" :class="a.changed ? 'text-indigo-200' : 'text-gray-300'">
            <td class="text-gray-500 pr-2 w-10 align-top">#{{ a.index }}</td>
            <td class="break-all">
              {{ a.value }}
              <span v-if="a.changed" class="text-[10px] text-indigo-400 ml-1">(was {{ a.from ?? '—' }} in the caller)</span>
            </td>
          </tr>
        </table>
      </section>

      <!-- Results -->
      <section v-if="info.values.length">
        <h3 class="section-title">Computed at compile time</h3>
        <div v-for="[k, v] in info.values" :key="k" class="font-mono">
          <span class="text-blue-300">{{ k }}</span> <span class="text-gray-500">=</span> <span class="text-emerald-300">{{ v }}</span>
        </div>
      </section>

      <!-- Why another overload won -->
      <section v-if="info.ranking">
        <h3 class="section-title">Why it lost</h3>
        <p class="text-gray-200">{{ RANKING_TEXT[info.ranking.reason] ?? 'Another candidate was a better match.' }}</p>
        <ul class="mt-1 space-y-0.5 list-disc pl-4 font-mono text-[11px] text-gray-400">
          <li v-for="(d, i) in info.ranking.details" :key="i" class="break-words">{{ d }}</li>
        </ul>
      </section>

      <!-- Constraint tree (C++20 concepts / requires-clauses) -->
      <section v-if="info.n.constraints">
        <h3 class="section-title">Constraints</h3>
        <ConstraintTree :node="info.n.constraints" />
      </section>

      <!-- Specialization matching -->
      <section v-if="info.n.specCandidates">
        <h3 class="section-title">Which specialization was used</h3>
        <div v-for="c in info.n.specCandidates" :key="c.pattern + c.line" class="font-mono flex gap-2" :class="c.chosen ? 'text-emerald-300' : 'text-gray-500'">
          <span class="w-4 text-center">{{ c.chosen ? '✔' : '·' }}</span>
          <span>{{ c.pattern }}</span>
          <button v-if="c.line" class="ml-auto hover:text-blue-300" @click="jumpToLine(c.line)">line {{ c.line }}</button>
        </div>
      </section>

      <!-- Children -->
      <section v-if="info.children.length">
        <h3 class="section-title">It caused {{ info.children.length }} further step{{ info.children.length === 1 ? '' : 's' }}</h3>
        <div class="flex flex-wrap gap-1">
          <button v-for="c in info.children.slice(0, 24)" :key="c.id" @click="focusNode(c.id)"
            class="font-mono rounded border px-1.5 py-0.5 hover:border-blue-400"
            :class="c.failed ? 'border-red-700/60 text-red-200' : 'border-gray-700 text-gray-300'">{{ c.name }}</button>
          <span v-if="info.children.length > 24" class="text-gray-500 self-center">+{{ info.children.length - 24 }} more</span>
        </div>
      </section>

      <!-- Cost -->
      <section>
        <h3 class="section-title">Cost</h3>
        <div class="flex gap-4 text-gray-300">
          <span>self <span class="text-gray-100 tabular-nums">{{ fmt(info.selfUs) }}</span></span>
          <span>total <span class="text-gray-100 tabular-nums">{{ fmt(info.totalUs) }}</span></span>
          <span v-if="info.n.memoHits">reused <span class="text-violet-300">{{ info.n.memoHits }}×</span> from cache</span>
        </div>
        <p v-if="info.n.memoHits" class="mt-1 text-gray-500">
          Each specialization is generated once per translation unit; later uses are cache hits. That is why recursive templates like Fibonacci are linear, not exponential, at compile time.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
  margin-bottom: 4px;
}
</style>
