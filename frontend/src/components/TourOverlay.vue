<!--
  Copyright (c) 2026 MetaTrace Contributors

  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { tourOpen, TOUR_DONE_KEY, traceSteps, code, standard, compileCode, currentStepIndex, focusNode, flatNodes } from '../store';
import { EXAMPLES } from '../examples';

// Guided tour for first-time visitors. Each step spotlights an element tagged with
// data-tour="<target>"; steps without a target are shown as a centered card.
interface TourStep {
  target?: string;
  tab?: string;              // Golden Layout tab to activate first
  title: string;
  body: string;
  before?: () => Promise<void> | void;
}

const ensureTrace = async () => {
  if (traceSteps.value.length > 0) return;
  const ex = EXAMPLES.find(e => e.id === 'fibonacci')!;
  code.value = ex.code;
  standard.value = ex.standard;
  await compileCode();
};

const selectSomething = async () => {
  await ensureTrace();
  // Pick a mid-recursion node so the Inspector has something interesting to explain
  const pick = flatNodes.value.find(f => f.depth === 2) ?? flatNodes.value[0];
  if (pick) await focusNode(pick.node.id);
};

const STEPS: TourStep[] = [
  {
    title: 'Welcome to MetaTrace',
    body: 'MetaTrace shows what the C++ compiler does with your templates: every instantiation, every overload it tries, and why candidates are thrown away. This short tour takes about a minute.'
  },
  {
    target: 'editor',
    title: 'Write or paste C++ here',
    body: 'Any template code works: type traits, concepts, variadic packs, even code that includes the standard library. Errors get squiggles, and the gutter lights up on lines that trigger template work.'
  },
  {
    target: 'examples',
    title: 'Start from an example',
    body: 'Each example shows off one technique (recursion, SFINAE, concepts, partial specialization, type lists…) and shows a tip about what to look at.'
  },
  {
    target: 'build',
    title: 'Build & Trace',
    body: 'Compiles your code with an embedded Clang and records every template step. We will load the Fibonacci example for you now.',
  },
  {
    target: 'graph',
    title: 'The instantiation graph',
    body: 'Each card is one thing the compiler did, grouped under the line of your code that caused it. Arrows mean "needed". Dotted ♻ arcs mean a result was reused from the cache. Click a card for details, double-click to collapse it.',
    before: ensureTrace
  },
  {
    target: 'graph-toolbar',
    title: 'Keep big traces readable',
    body: 'The View menu hides compiler bookkeeping and std:: internals, or collapses whole subtrees. Use Find to jump to any template by name.',
    before: ensureTrace
  },
  {
    target: 'timeline',
    title: 'Replay the compilation',
    body: 'Scrub or press Play to watch templates instantiate in order. Keyboard: ← → step, ↑ step out, ↓ step over, Space play/pause.',
    before: async () => { await ensureTrace(); currentStepIndex.value = Math.min(6, traceSteps.value.length - 1); }
  },
  {
    target: 'inspector',
    tab: 'Inspector',
    title: 'The Inspector explains it in plain English',
    body: 'What happened, why it is there (the chain back to your code), which arguments changed, computed values, and which specialization was picked.',
    before: selectSomething
  },
  {
    target: 'overloads',
    tab: 'Overloads & Specializations',
    title: 'Why was that overload chosen?',
    body: 'For every call, each template candidate appears as selected, rejected by SFINAE, or discarded by unmet concepts, with the compiler\'s exact reason. Partial specialization matching shows up here too.'
  },
  {
    target: 'hotspots',
    tab: 'Template Hotspots',
    title: 'What makes compilation slow?',
    body: 'Templates ranked by compile time, with instantiation counts, cache reuse and recursion depth. Expand a row to see how its arguments change step by step.'
  },
  {
    target: 'help',
    title: 'You are all set',
    body: 'Replay this tour or see the keyboard shortcuts at any time from the Help menu. Happy metaprogramming!'
  }
];

const index = ref(0);
const rect = ref<DOMRect | null>(null);
const busy = ref(false);
const step = computed(() => STEPS[index.value]);

const activateTab = (title: string) => {
  const tab = [...document.querySelectorAll('.lm_tab')].find(t => t.querySelector('.lm_title')?.textContent?.trim() === title) as HTMLElement | undefined;
  tab?.click();
};

const measure = () => {
  const s = step.value;
  const el = s.target ? document.querySelector(`[data-tour="${s.target}"]`) as HTMLElement | null : null;
  const r = el?.getBoundingClientRect();
  rect.value = r && r.width > 0 && r.height > 0 ? r : null;
};

const show = async () => {
  busy.value = true;
  try {
    await step.value.before?.();
    if (step.value.tab) activateTab(step.value.tab);
    await nextTick();
    await new Promise(r => setTimeout(r, 120)); // let panels finish laying out
    measure();
  } finally {
    busy.value = false;
  }
};

const finish = () => {
  try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch { /* storage may be unavailable */ }
  tourOpen.value = false;
};

const next = () => {
  if (busy.value) return;
  if (index.value >= STEPS.length - 1) return finish();
  index.value++;
};
const back = () => {
  if (busy.value || index.value === 0) return;
  index.value--;
};

watch(index, show);
watch(tourOpen, open => {
  if (open) {
    index.value = 0;
    show();
  }
});

const onKey = (e: KeyboardEvent) => {
  if (!tourOpen.value) return;
  if (e.key === 'Escape') { finish(); e.preventDefault(); e.stopImmediatePropagation(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { next(); e.preventDefault(); e.stopImmediatePropagation(); }
  else if (e.key === 'ArrowLeft') { back(); e.preventDefault(); e.stopImmediatePropagation(); }
};

onMounted(() => {
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', measure);
  if (tourOpen.value) show();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', measure);
});

const PAD = 6;
const CARD_W = 340;

const spotlightStyle = computed(() => {
  const r = rect.value;
  if (!r) return null;
  return {
    left: `${r.left - PAD}px`,
    top: `${r.top - PAD}px`,
    width: `${r.width + PAD * 2}px`,
    height: `${r.height + PAD * 2}px`
  };
});

// Place the card beside the target where there is room, clamped to the viewport
const cardStyle = computed(() => {
  const r = rect.value;
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!r) return { left: `${(vw - CARD_W) / 2}px`, top: `${Math.max(24, vh / 2 - 120)}px`, width: `${CARD_W}px` };
  const gap = 14;
  let left: number, top: number;
  if (r.right + gap + CARD_W < vw) { left = r.right + gap; top = r.top; }
  else if (r.left - gap - CARD_W > 0) { left = r.left - gap - CARD_W; top = r.top; }
  else { left = r.left + r.width / 2 - CARD_W / 2; top = r.bottom + gap; }
  if (top + 220 > vh) top = Math.max(12, r.top - 220 - gap);
  left = Math.min(Math.max(12, left), vw - CARD_W - 12);
  top = Math.min(Math.max(12, top), vh - 200);
  return { left: `${left}px`, top: `${top}px`, width: `${CARD_W}px` };
});
</script>

<template>
  <div v-if="tourOpen" class="fixed inset-0 z-[100]" role="dialog" aria-modal="true" :aria-label="step.title">
    <!-- Dim everything except the spotlighted element -->
    <div v-if="spotlightStyle" class="tour-spotlight" :style="spotlightStyle"></div>
    <div v-else class="absolute inset-0 bg-black/60"></div>

    <div class="tour-card" :style="cardStyle">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] uppercase tracking-wider text-blue-300">Step {{ index + 1 }} of {{ STEPS.length }}</span>
        <button class="text-gray-400 hover:text-white text-xs" @click="finish" title="Skip the tour (Esc)">Skip tour</button>
      </div>
      <h3 class="text-base font-semibold text-white">{{ step.title }}</h3>
      <p class="mt-1.5 text-sm leading-relaxed text-gray-300">{{ step.body }}</p>

      <div class="mt-3 flex items-center gap-1" aria-hidden="true">
        <span v-for="(_, i) in STEPS" :key="i" class="h-1 rounded-full transition-all" :class="i === index ? 'w-5 bg-blue-400' : 'w-1.5 bg-gray-600'"></span>
      </div>

      <div class="mt-3 flex items-center justify-end gap-2">
        <button v-if="index > 0" @click="back" class="px-3 py-1 text-sm rounded border border-gray-600 text-gray-200 hover:bg-gray-700">Back</button>
        <button @click="next" :disabled="busy" class="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60">
          {{ busy ? 'Loading…' : index === STEPS.length - 1 ? 'Finish' : 'Next' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour-spotlight {
  position: fixed;
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.62);
  outline: 2px solid #60a5fa;
  pointer-events: none;
  transition: left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease;
}
.tour-card {
  position: fixed;
  background: #111827;
  border: 1px solid #374151;
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  transition: left 0.25s ease, top 0.25s ease;
}
@media (prefers-reduced-motion: reduce) {
  .tour-spotlight, .tour-card { transition: none; }
}
</style>
