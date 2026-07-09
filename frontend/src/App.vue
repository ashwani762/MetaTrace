<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, createApp } from 'vue'
import DebuggerControls from './components/DebuggerControls.vue';
import EditorPanel from './components/EditorPanel.vue';
import GraphPanel from './components/GraphPanel.vue';
import StackPanel from './components/StackPanel.vue';
import VariablesPanel from './components/VariablesPanel.vue';

import OutputPanel from './components/OutputPanel.vue';

import { GoldenLayout, LayoutConfig, ResolvedLayoutConfig } from 'golden-layout';
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';

import { 
  standard, 
  isCompiling, 
  traceSteps, 
  logicalStepIndex,
  logicalMaxSteps,
  compileCode,
  stopCompile,
  resetVisualizer,
  handleStep
} from './store';

const layoutContainer = ref<HTMLElement | null>(null);
let layout: GoldenLayout | null = null;
const appInstances: ReturnType<typeof createApp>[] = [];

const config: LayoutConfig = {
  root: {
    type: 'column',
    content: [
      {
        type: 'row',
        height: 70,
        content: [
          {
            type: 'component',
            componentType: 'Editor',
            title: 'main.cpp',
            width: 40
          },
          {
            type: 'component',
            componentType: 'Graph',
            title: 'Instantiation Graph',
            width: 60
          }
        ]
      },
      {
        type: 'row',
        height: 30,
        content: [
          {
            type: 'component',
            componentType: 'Output',
            title: 'Output',
            width: 33
          },
          {
            type: 'component',
            componentType: 'Stack',
            title: 'Call Stack',
            width: 33
          },
          {
            type: 'component',
            componentType: 'Variables',
            title: 'Variables',
            width: 34
          }
        ]
      }
    ]
  }
};

const notification = ref('');
let notifTimeout: any = null;
const showNotification = (msg: string) => {
  notification.value = msg;
  if (notifTimeout) clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => { notification.value = ''; }, 3000);
};

/**
 * Initializes the GoldenLayout grid and registers all panels.
 * 
 * @param useSaved - If true, attempts to load the layout configuration from localStorage.
 */
const initLayout = (useSaved: boolean = true) => {
  if (!layoutContainer.value) return;
  
  if (layout) {
    appInstances.forEach(app => app.unmount());
    appInstances.length = 0;
    layout.destroy();
    layoutContainer.value.innerHTML = ''; // Ensure DOM is clean
  }

  let layoutConfig = config;
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
        if (!layoutConfig.root) layoutConfig = config;
        else layoutConfig = LayoutConfig.fromResolved(layoutConfig as unknown as ResolvedLayoutConfig);
      } catch (e) {
        console.error("Failed to parse saved layout", e);
        layoutConfig = config;
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

  layout.init();
};


const resetLayout = () => {
  localStorage.removeItem('savedGoldenLayout');
  initLayout(false);
  showNotification('Layout reset to default!');
};

const resizeHandler = () => {
  if (layout && layoutContainer.value) {
    layout.updateSize(layoutContainer.value.offsetWidth, layoutContainer.value.offsetHeight);
  }
};

onMounted(() => {
  initLayout(true);
  window.addEventListener('resize', resizeHandler);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeHandler);
  appInstances.forEach(app => app.unmount());
  if (layout) layout.destroy();
});
</script>

<template>
  <div class="h-screen w-full flex flex-col bg-gray-950 text-gray-200 font-sans">
    
    <!-- Top Nav -->
    <header class="h-14 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-4 shrink-0 relative">
      <div class="flex items-center space-x-4">
        <div class="flex flex-col min-w-[240px]">
          <h1 class="font-bold text-lg tracking-wide text-gray-100 flex items-center leading-none">
            <svg class="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
            C++ Template Visualizer
          </h1>
          <div class="flex items-center justify-between mt-1.5 opacity-0 transition-opacity duration-300" :class="{ 'opacity-100': logicalMaxSteps > 0 }">
            <div class="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(34,211,238,0.6)]" :style="{ width: logicalMaxSteps > 0 ? ((logicalStepIndex + 1) / logicalMaxSteps) * 100 + '%' : '0%' }"></div>
            </div>
          </div>
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

      <div class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <DebuggerControls @step="handleStep" :canStep="traceSteps.length > 0" :stepIndex="logicalStepIndex" :maxSteps="logicalMaxSteps" />
      </div>
      
      <div class="flex items-center space-x-2">

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

    <!-- Notification Popup -->
    <transition enter-active-class="transition ease-out duration-300" enter-from-class="transform translate-y-2 opacity-0" enter-to-class="transform translate-y-0 opacity-100" leave-active-class="transition ease-in duration-200" leave-from-class="transform translate-y-0 opacity-100" leave-to-class="transform translate-y-2 opacity-0">
      <div v-if="notification" class="absolute bottom-4 right-4 bg-gray-800 text-green-400 border border-green-800 px-4 py-2 rounded shadow-lg flex items-center z-50">
        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        {{ notification }}
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
