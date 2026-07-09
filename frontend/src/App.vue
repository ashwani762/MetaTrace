<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, createApp } from 'vue'

import EditorPanel from './components/EditorPanel.vue';
import GraphPanel from './components/GraphPanel.vue';
import StackPanel from './components/StackPanel.vue';
import VariablesPanel from './components/VariablesPanel.vue';
import OutputPanel from './components/OutputPanel.vue';
import ExplanationPanel from './components/ExplanationPanel.vue';
import ScrubberPanel from './components/ScrubberPanel.vue';
import FlamegraphPanel from './components/FlamegraphPanel.vue';
import TypeResolutionPanel from './components/TypeResolutionPanel.vue';

import { GoldenLayout, LayoutConfig, ResolvedLayoutConfig } from 'golden-layout';
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';

import { 
  standard, 
  isCompiling, 
  traceSteps, 
  resetVisualizer,
  compileCode,
  stopCompile
} from './store';

const layoutContainer = ref<HTMLElement | null>(null);
const showThankYou = ref(false);
let layout: GoldenLayout | null = null;
const appInstances: ReturnType<typeof createApp>[] = [];

const visiblePanels = ref({
  Code: true,
  Visualizer: true,
  Output: true,
  Explanation: true,
  Stack: false,
  Variables: false,
  Flamegraph: false,
  TypeResolution: false
});

const showViewMenu = ref(false);

const generateConfig = (): LayoutConfig => {
  const leftCol = [];
  if (visiblePanels.value.Code) leftCol.push({ type: 'component', componentType: 'Editor', title: 'Code Editor', height: 70 });
  if (visiblePanels.value.Output) leftCol.push({ type: 'component', componentType: 'Output', title: 'Output', height: 30 });

  const rightTop = [];
  if (visiblePanels.value.Visualizer) rightTop.push({ type: 'component', componentType: 'Graph', title: 'Instantiation Graph' });

  const rightBottom = [];
  if (visiblePanels.value.Stack) rightBottom.push({ type: 'component', componentType: 'Stack', title: 'Call Stack' });
  if (visiblePanels.value.Variables) rightBottom.push({ type: 'component', componentType: 'Variables', title: 'Variables' });
  if (visiblePanels.value.Explanation) rightBottom.push({ type: 'component', componentType: 'Explanation', title: 'Steps & Explanations' });
  if (visiblePanels.value.Flamegraph) rightBottom.push({ type: 'component', componentType: 'Flamegraph', title: 'Flamegraph' });
  if (visiblePanels.value.TypeResolution) rightBottom.push({ type: 'component', componentType: 'TypeResolution', title: 'Type Resolution' });

  const rightCol = [];
  if (rightTop.length > 0) rightCol.push({ type: 'row', height: rightBottom.length > 0 ? 70 : 100, content: rightTop });
  if (rightBottom.length > 0) rightCol.push({ type: 'row', height: rightTop.length > 0 ? 30 : 100, content: rightBottom });

  const content: any[] = [];
  if (leftCol.length > 0) content.push({ type: 'column', width: 30, content: leftCol });
  if (rightCol.length > 0) content.push({ type: 'column', width: 70, content: rightCol });

  return {
    settings: {
      showPopoutIcon: false
    },
    root: {
      type: 'row',
      content: content
    }
  };
};

const notification = ref('');
let notifTimeout: any = null;
const showNotification = (msg: string) => {
  notification.value = msg;
  if (notifTimeout) clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => { notification.value = ''; }, 3000);
};

const downloadNotif = ref('');
const handleDownloadProgress = (e: Event) => {
  const ce = e as CustomEvent;
  downloadNotif.value = ce.detail;
  if (ce.detail.includes('complete') || ce.detail.includes('Error')) {
    setTimeout(() => { downloadNotif.value = ''; }, 4000);
  }
};

let isLayoutInitializing = false;

/**
 * Initializes the GoldenLayout grid and registers all panels.
 * 
 * @param useSaved - If true, attempts to load the layout configuration from localStorage.
 */
const initLayout = (useSaved: boolean = true) => {
  if (!layoutContainer.value) return;
  
  isLayoutInitializing = true;
  if (layout) {
    appInstances.forEach(app => app.unmount());
    appInstances.length = 0;
    layout.destroy();
    layoutContainer.value.innerHTML = ''; // Ensure DOM is clean
  }

  let layoutConfig = generateConfig();
  if (useSaved) {
    const saved = localStorage.getItem('savedGoldenLayout');
    if (saved) {
      try {
        layoutConfig = JSON.parse(saved);
        
        // GoldenLayout v2 crashes if width/height/size are numbers because it tries to call trimStart()
        const fixSizes = (obj: any) => {
          if (Array.isArray(obj)) {
            obj.forEach(fixSizes);
          } else if (obj !== null && typeof obj === 'object') {
            ['width', 'height', 'size', 'minWidth', 'minHeight'].forEach(key => {
              if (typeof obj[key] === 'number') obj[key] = String(obj[key]) + '%';
            });
            Object.values(obj).forEach(fixSizes);
          }
        };
        fixSizes(layoutConfig);

        // GoldenLayout might save root as resolved component. Ensure it's valid.
        if (!layoutConfig.root) layoutConfig = generateConfig();
        else layoutConfig = LayoutConfig.fromResolved(layoutConfig as unknown as ResolvedLayoutConfig);
      } catch (e) {
        console.error("Failed to parse saved layout", e);
        layoutConfig = generateConfig();
      }
    }
  }

  layout = new GoldenLayout(layoutConfig, layoutContainer.value);

  const register = (name: string, Component: any) => {
    layout!.registerComponent(name, (container) => {
      const app = createApp(Component);
      app.mount(container.element);
      appInstances.push(app);
    });
  };

  register('Editor', EditorPanel);
  register('Graph', GraphPanel);
  register('Stack', StackPanel);
  register('Variables', VariablesPanel);
  register('Output', OutputPanel);
  register('Explanation', ExplanationPanel);
  register('Scrubber', ScrubberPanel);
  register('Flamegraph', FlamegraphPanel);
  register('TypeResolution', TypeResolutionPanel);

  layout.addEventListener('itemDestroyed', (ev: any) => {
    if (isLayoutInitializing) return;
    if (ev.target && ev.target.isComponent) {
      const compName = ev.target.componentType;
      const mapComponentToPanel: Record<string, string> = {
        'Editor': 'Code',
        'Graph': 'Visualizer',
        'Output': 'Output',
        'Stack': 'Stack',
        'Variables': 'Variables',
        'Explanation': 'Explanation',
        'Flamegraph': 'Flamegraph',
        'TypeResolution': 'TypeResolution'
      };
      const panelKey = mapComponentToPanel[compName];
      if (panelKey && visiblePanels.value[panelKey as keyof typeof visiblePanels.value]) {
        visiblePanels.value[panelKey as keyof typeof visiblePanels.value] = false;
        localStorage.setItem('savedGoldenLayout', JSON.stringify(layout!.saveLayout()));
      }
    }
  });

  layout.init();
  isLayoutInitializing = false;
};

const resetLayout = () => {
  localStorage.removeItem('savedGoldenLayout');
  visiblePanels.value = {
    Code: true,
    Visualizer: true,
    Output: true,
    Explanation: true,
    Stack: false,
    Variables: false,
    Flamegraph: false,
    TypeResolution: false
  };
  initLayout(false);
  showNotification('Layout reset to default!');
};

const togglePanel = (panel: keyof typeof visiblePanels.value) => {
  visiblePanels.value[panel] = !visiblePanels.value[panel];
  initLayout(false);
};

const resizeHandler = () => {
  if (layout && layoutContainer.value) {
    layout.updateSize(layoutContainer.value.offsetWidth, layoutContainer.value.offsetHeight);
  }
};

onMounted(() => {
  initLayout(true);
  window.addEventListener('resize', resizeHandler);
  window.addEventListener('clangd-download-progress', handleDownloadProgress);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeHandler);
  window.removeEventListener('clangd-download-progress', handleDownloadProgress);
  appInstances.forEach(app => app.unmount());
  if (layout) layout.destroy();
});
</script>

<template>
  <div class="h-screen w-full flex flex-col bg-gray-950 text-gray-200 font-sans">
    
    <!-- Top Nav -->
    <header class="h-14 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-4 shrink-0 relative">
      <div class="flex items-center space-x-4">
        <div class="flex flex-col">
          <h1 class="font-bold text-lg tracking-wide text-gray-100 flex items-center leading-none">
            <svg class="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
            MetaTrace
          </h1>
        </div>
        <div class="h-6 w-px bg-gray-700"></div>
        <select v-model="standard" class="bg-gray-800 border border-gray-700 text-sm rounded px-2 py-1 outline-none focus:border-blue-500">
          <option value="c++98">C++98</option>
          <option value="c++11">C++11</option>
          <option value="c++14">C++14</option>
          <option value="c++17">C++17</option>
          <option value="c++20">C++20</option>
          <option value="c++23">C++23</option>
          <option value="c++26">C++26</option>
        </select>
        <button 
          @click="compileCode" 
          :disabled="isCompiling"
          class="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded shadow flex items-center transition-colors"
        >
          <svg v-if="isCompiling" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {{ isCompiling ? 'Compiling...' : 'Build & Trace' }}
        </button>
        <button 
          v-if="isCompiling"
          @click="stopCompile"
          class="bg-red-600 hover:bg-red-500 text-white text-sm px-3 py-1.5 rounded shadow flex items-center transition-colors"
          title="Stop Compilation"
        >
          <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg>
          Stop
        </button>
        <button 
          v-if="traceSteps.length > 0 && !isCompiling"
          @click="resetVisualizer"
          class="bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm px-3 py-1.5 rounded shadow flex items-center transition-colors"
          title="Clear Visualizer"
        >
          <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
          Clear
        </button>
      </div>

      <div class="flex items-center space-x-2">
        <div class="relative">
          <button 
            @click="showViewMenu = !showViewMenu"
            class="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 text-sm px-3 py-1.5 rounded shadow flex items-center transition-colors mr-2 relative z-50"
          >
            <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
            View Panels
          </button>
          
          <!-- Click outside overlay -->
          <div v-if="showViewMenu" @click="showViewMenu = false" class="fixed inset-0 z-40"></div>

          <div v-if="showViewMenu" class="absolute right-2 top-full mt-1 bg-gray-800 border border-gray-700 shadow-xl rounded z-50 min-w-[150px] p-2 flex flex-col space-y-2">
            <label v-for="(val, key) in visiblePanels" :key="key" class="flex items-center space-x-2 cursor-pointer text-sm text-gray-200 hover:bg-gray-700 px-2 py-1 rounded">
              <input type="checkbox" :checked="val" @change="togglePanel(key)" class="rounded bg-gray-900 border-gray-700 text-blue-500 focus:ring-0">
              <span>{{ key }}</span>
            </label>
          </div>
        </div>

        <button 
          @click="showThankYou = true"
          class="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 text-sm px-3 py-1.5 rounded shadow flex items-center transition-colors mr-2"
          title="Acknowledgments & Licenses"
        >
          <svg class="w-4 h-4 mr-1.5 text-pink-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          Thank You
        </button>

        <button 
          @click="resetLayout"
          class="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 text-sm px-3 py-1.5 rounded shadow flex items-center transition-colors"
          title="Reset Window Layout"
        >
          <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          Reset Layout
        </button>
      </div>
    </header>

    <!-- Golden Layout Container -->
    <main ref="layoutContainer" class="flex-1 w-full relative"></main>

    <!-- Thank You Modal -->
    <div v-if="showThankYou" class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col text-gray-200">
        <div class="flex justify-between items-center p-4 border-b border-gray-700">
          <h2 class="text-xl font-bold flex items-center">
            <svg class="w-6 h-6 mr-2 text-pink-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            Acknowledgments
          </h2>
          <button @click="showThankYou = false" class="text-gray-400 hover:text-white transition-colors">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        <div class="p-6 overflow-y-auto flex-1 space-y-6">
          <p class="text-sm text-gray-400">MetaTrace is made possible thanks to the incredible open-source work of many developers and organizations. Thank you to the authors and maintainers of the following projects:</p>
          
          <div class="space-y-4">
            <div class="bg-gray-900 p-4 rounded border border-gray-700">
              <h3 class="font-bold text-blue-400 text-lg">LLVM Project (Clang)</h3>
              <p class="text-sm mt-1 mb-2">Provides the foundational compiler frontend technology used to accurately trace C++ templates.</p>
              <div class="text-xs text-gray-500 font-mono">License: Apache 2.0 with LLVM Exceptions</div>
            </div>

            <div class="bg-gray-900 p-4 rounded border border-gray-700">
              <h3 class="font-bold text-green-400 text-lg">Vue.js & Vite</h3>
              <p class="text-sm mt-1 mb-2">The incredibly fast, progressive JavaScript framework and build tool powering this interface.</p>
              <div class="text-xs text-gray-500 font-mono">License: MIT License</div>
            </div>

            <div class="bg-gray-900 p-4 rounded border border-gray-700">
              <h3 class="font-bold text-blue-300 text-lg">Monaco Editor</h3>
              <p class="text-sm mt-1 mb-2">The powerful code editor from Microsoft that drives VS Code, providing syntax highlighting and editing in MetaTrace.</p>
              <div class="text-xs text-gray-500 font-mono">License: MIT License</div>
            </div>

            <div class="bg-gray-900 p-4 rounded border border-gray-700">
              <h3 class="font-bold text-purple-400 text-lg">Vue Flow & Dagre</h3>
              <p class="text-sm mt-1 mb-2">Provides the interactive, node-based flowchart visualization and the automatic layout engine.</p>
              <div class="text-xs text-gray-500 font-mono">License: MIT License</div>
            </div>
            
            <div class="bg-gray-900 p-4 rounded border border-gray-700">
              <h3 class="font-bold text-yellow-400 text-lg">Golden Layout</h3>
              <p class="text-sm mt-1 mb-2">Provides the robust, drag-and-drop window management and docking system.</p>
              <div class="text-xs text-gray-500 font-mono">License: MIT License</div>
            </div>
            
            <div class="bg-gray-900 p-4 rounded border border-gray-700">
              <h3 class="font-bold text-teal-400 text-lg">Tailwind CSS</h3>
              <p class="text-sm mt-1 mb-2">The utility-first CSS framework that makes styling this application simple and beautiful.</p>
              <div class="text-xs text-gray-500 font-mono">License: MIT License</div>
            </div>

            <div class="bg-gray-900 p-4 rounded border border-gray-700">
              <h3 class="font-bold text-gray-300 text-lg">Express.js & pkg</h3>
              <p class="text-sm mt-1 mb-2">Powering the backend API server and bundling the entire application into a single executable.</p>
              <div class="text-xs text-gray-500 font-mono">License: MIT License</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Notification Popup -->
    <transition enter-active-class="transition ease-out duration-300" enter-from-class="transform translate-y-2 opacity-0" enter-to-class="transform translate-y-0 opacity-100" leave-active-class="transition ease-in duration-200" leave-from-class="transform translate-y-0 opacity-100" leave-to-class="transform translate-y-2 opacity-0">
      <div v-if="notification" class="absolute bottom-4 right-4 bg-gray-800 text-green-400 border border-green-800 px-4 py-2 rounded shadow-lg flex items-center z-50">
        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        {{ notification }}
      </div>
    </transition>

    <!-- Download Notification Popup -->
    <transition enter-active-class="transition ease-out duration-300" enter-from-class="transform translate-y-2 opacity-0" enter-to-class="transform translate-y-0 opacity-100" leave-active-class="transition ease-in duration-200" leave-from-class="transform translate-y-0 opacity-100" leave-to-class="transform translate-y-2 opacity-0">
      <div v-if="downloadNotif" class="absolute bottom-6 right-6 bg-gray-900/90 backdrop-blur-md text-emerald-400 border border-emerald-500/50 px-5 py-3 rounded-xl shadow-2xl flex items-center z-50 font-medium tracking-wide">
        <svg class="w-5 h-5 mr-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" v-if="!downloadNotif.includes('complete') && !downloadNotif.includes('Error')"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" v-if="downloadNotif.includes('complete')"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        <svg class="w-5 h-5 mr-2 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" v-if="downloadNotif.includes('Error')"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        {{ downloadNotif }}
      </div>
    </transition>
  </div>
</template>

<style>
.lm_header { background: #1f2937 !important; border-bottom: 1px solid #374151 !important; }
.lm_title { color: #9ca3af !important; font-family: monospace; font-size: 12px; }
.lm_tab { background: #111827 !important; border-right: 1px solid #374151 !important; }
.lm_tab.lm_active { background: #1f2937 !important; color: #fff !important; }
.lm_splitter { background: #374151 !important; }
.lm_splitter:hover { background: #3b82f6 !important; }
</style>
