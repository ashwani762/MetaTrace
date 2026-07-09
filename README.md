# C++ Template Instantiation Visualizer 🚀

A full-stack, browser-based debugger and visualizer for C++ template metaprogramming. 

Template metaprogramming in C++ is notoriously difficult to debug, often resulting in cryptic error messages and deep recursion trees that are impossible to follow. This project solves that by integrating directly into the Clang compilation pipeline to trace, record, and interactively visualize C++ template instantiations!

## Features 🌟

- **Interactive Graph Visualization:** View the deep instantiation hierarchy of your templates in a beautiful, layout-aware DAG (Directed Acyclic Graph) using GoldenLayout and Vue Flow.
- **Time-Travel Debugging:** Step backward and forward through the exact sequence of instantiation events just like a traditional debugger.
- **Language Server Protocol (LSP):** Integrated Monaco editor backed by a bundled `clangd` language server provides full C++ code completion, inline diagnostics, and hover support right in your browser.
- **Standalone Release Bundle:** The backend is packaged into a self-contained executable that hosts the frontend SPA and runs the Clang plugin. No dependencies or build environments required to run the release!
- **Data Persistence:** Save and restore your personalized, resizable GoldenLayout pane arrangements.

## Architecture 🏗️

The project is broken into three main components:

1. **Frontend:** A modern Vue 3 SPA built with Vite, utilizing `golden-layout` for pane management, `monaco-editor` for the LSP-backed coding environment, and `@vue-flow` for the interactive template graph.
2. **Backend:** A Node.js Express server that orchestrates compilation runs, manages the WebSocket connection for the `clangd` language server, and serves the frontend assets.
3. **Clang Plugin (`Visualizer.exe`):** A custom C++ executable built against LLVM/Clang Tooling APIs that intercepts AST compilation events (like `InstantiateClass` and `InstantiateFunction`), evaluates the runtime context, and generates a time-series `trace_custom.json` profile of your metaprograms.

## Quick Start 🚀

### Running the Release
1. Navigate to the `release/` directory.
2. Run `server.exe`.
3. Open your browser to [http://localhost:3001](http://localhost:3001).

### Development Mode
1. Start the frontend: `cd frontend && npm run dev`
2. Start the backend: `cd backend && npm run dev`
3. The system expects `clangd.exe` to be available in your path or located in the `external/` folder.

## License 📜

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
