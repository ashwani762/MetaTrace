# MetaTrace Guide

A complete guide to using, building and extending MetaTrace. For a quick overview, see the [README](../README.md).

- [1. What MetaTrace shows you](#1-what-metatrace-shows-you)
- [2. Installing and running](#2-installing-and-running)
- [3. The workspace](#3-the-workspace)
- [4. Reading the instantiation graph](#4-reading-the-instantiation-graph)
- [5. Panels in detail](#5-panels-in-detail)
- [6. Examples gallery](#6-examples-gallery)
- [7. Keyboard shortcuts](#7-keyboard-shortcuts)
- [8. How it works](#8-how-it-works)
- [9. Building from source](#9-building-from-source)
- [10. Testing](#10-testing)
- [11. Continuous integration and releases](#11-continuous-integration-and-releases)
- [12. Troubleshooting](#12-troubleshooting)
- [Contributing](#contributing)

---

## 1. What MetaTrace shows you

C++ template errors and surprises usually come down to a few questions. MetaTrace answers each one:

| Question | Where to look |
|---|---|
| *Which templates got instantiated, and in what order?* | Instantiation graph, timeline |
| *Why does this specialization exist? Which line of my code caused it?* | Inspector → **Why is this here?** |
| *Why was this overload chosen and not that one?* | Overloads & Specializations |
| *Why did SFINAE remove my function? Which concept failed?* | Red/amber cards, Inspector, Overloads panel |
| *Which partial specialization matched?* | Overloads & Specializations → *Class template specialization* |
| *What value or type did it compute?* | Card result line (`⇒ value = 55`), Inspector |
| *What makes my build slow? How deep is my recursion?* | Template Hotspots |

All of this comes from the compiler itself (Clang 22), not from guessing.

## 2. Installing and running

### Prebuilt packages

Download `MetaTrace-windows-x64.zip` or `MetaTrace-linux-x64.tar.gz` from [Releases](https://github.com/ashwani762/MetaTrace/releases). Every CI run also uploads them as build artifacts. Each package is a single executable.

```bash
./MetaTrace                 # Linux
MetaTrace.exe               # Windows
```

Open **http://localhost** (or the port you chose).

| Option | Meaning |
|---|---|
| `--port`, `-p <n>` | Port to listen on (default 80) |
| `--host <addr>` | Address to bind (default 127.0.0.1) |
| `--expose` | Bind to 0.0.0.0 so other machines can connect |
| `--debug`, `-d` | Log every compiler invocation |

**Requirements.** MetaTrace ships its own Clang, including Clang's builtin headers. It uses your system's C++ standard library:
- **Windows:** Visual Studio or the Build Tools with the "Desktop development with C++" workload.
- **Linux:** `g++` / `build-essential` (libstdc++ headers).

On first start the Visualizer and its headers are extracted to your temp folder (`%TEMP%\MetaTrace` or `/tmp/MetaTrace`). The optional clangd language server is downloaded on first use for autocomplete.

## 3. The workspace

```
┌──────────────┬───────────────────────────────┬──────────────────────┐
│ Code editor  │                               │ Inspector            │
│              │     Instantiation graph       │ Overloads & Spec.    │
│              │                               │ Template Hotspots    │
├──────────────┤     (timeline at the bottom)  │ Step Log   (tabs)    │
│ Compiler     │                               │                      │
│ output       │                               │                      │
└──────────────┴───────────────────────────────┴──────────────────────┘
```

- **Header:** C++ standard (C++98 to C++26), *Examples…*, **Build & Trace**, *View Panels* (show/hide any panel), *Thank You*, *Help* (tour, shortcuts, acknowledgments), *Reset Layout*.
- Panels can be dragged, docked, resized and maximized. The layout is remembered per browser.
- More panels are available from *View Panels*: **Desugared C++** (the instantiated code), **Call Stack**, **Variables**, **Flamegraph** and **Type Resolution**.
- New visitors get a short guided tour. Replay it any time from **Help → Take the tour**.

## 4. Reading the instantiation graph

### Lanes

Top-level work is grouped into **lanes**, one per source line that triggered it, stacked in source order. The lane header shows the line, the code, how many steps it caused and how many candidates were discarded. Click it to jump to the line.

### Cards

Each card is one compiler step:

```
┌───────────────────────────────────────────┐
│ [CLASS] Fib                          L4 ▾ │  phase badge · template · triggering line · collapse
│ ‹10›                                      │  template arguments
│ ⇒ value = 55    ♻ reused 2×               │  computed result · cache hits
│ ✖ failed requirement ...                  │  (only if discarded) Clang's reason
└───────────────────────────────────────────┘
```

| Badge | Meaning |
|---|---|
| **class / function body / variable** | A specialization was generated (instantiated) |
| **candidate** | An overload candidate: Clang deduced its arguments and substituted them into the signature |
| **concept check** | A concept / requires-clause was checked |
| **alias** | An alias template such as `enable_if_t` was substituted |
| **base case** | An explicit specialization was used; nothing had to be generated, so recursion stops here |

| Colour | Meaning |
|---|---|
| Blue glow | The step at the current timeline position |
| Dark blue | In progress (waiting on the steps it caused) |
| Green | Completed |
| Orange | Type alias |
| Red, dashed | Discarded candidate (SFINAE or unmet constraints) |
| Purple | Selected |
| Dashed border | Candidate or base case |

### Edges

- **Solid arrow:** "needed", meaning the parent caused the child.
- **"signature deduction" label:** the child was needed only to check a candidate's signature.
- **Dotted ♻ arc:** the specialization already existed and was **reused from the cache**. This is why a naive compile-time Fibonacci is linear, not exponential.

### Controls

- **Click** a card: select it. The Inspector explains it and the editor jumps to its line.
- **Double-click** a card (or its ▾): collapse or expand its subtree. On a folded recursion card, double-click (or **expand**) shows every level.
- **View ▾**
  - **Simple view** (on by default): hides compiler bookkeeping such as constraint normalization, parameter mapping and internal partial-specialization checks. Failures are never hidden.
  - **Hide std internals:** hides templates not declared in your file.
  - **Fold recursion** (on by default): a template instantiating itself three or more times in a row, such as `Fib<12> → Fib<11> → … → Fib<2>`, is shown as one card. The card lists the argument at each level (`↻ 11 levels ‹12› → ‹11› → … → ‹2›`); base cases and other work stay attached to it.
  - **Reuse edges:** toggles the ♻ arcs.
  - **Collapse all** / **Expand all.**
- **Find template…**: type a name and press Enter to cycle through matches.
- **Export PNG:** a high-resolution image of the whole graph.
- **Timeline:** scrub, step, play/pause and set the speed (1× to 40×). The layout never moves while you step; nodes appear as the compiler reaches them.

## 5. Panels in detail

### Inspector
For the selected card, or the current timeline step:
- **Headline:** one sentence describing what the compiler did, for example *"Tried `twice` (declared at line 5) as a candidate for the call at line 13:5…"*.
- **Outcome:** the SFINAE or constraint reason if it was discarded.
- **Why is this here?:** the causal chain from your code down to this step, with each triggering source line.
- **Template arguments:** arguments that changed relative to a recursive caller are highlighted (*was 11 in the caller*).
- **Computed at compile time:** `constexpr` values, plus the `value` / `type` a specialization produces. This includes library traits and alias templates, e.g. `std::is_integral<char>` → `value = true` and `std::conditional_t<false, long, int>` → `type = int`. Cards show the same result (`⇒ type = int`).
- **Why it lost** (viable overload candidates only): the rule Clang used to prefer another candidate, with a per-argument comparison. See [Overload ranking](#overload-ranking).
- **Constraints** (constrained candidates): the full constraint tree, described below.
- **Which specialization was used:** the primary template and all partial specializations, with the winner marked.
- **Further steps** and **Cost** (self and total time, cache reuse).

### Overloads & Specializations
- **One block per call site.** Each candidate appears as:
  - ✔ **Selected**
  - ○ **Viable, not chosen**, with the reason it lost (see below)
  - ✖ **Not viable**: deduction succeeded, but the arguments cannot bind (e.g. an lvalue passed to `T&&`)
  - ✖ **Rejected (SFINAE)**, with Clang's suppressed diagnostic
  - ⊘ **Constraints not satisfied**, naming the concept or requirement that failed, e.g. `'c.begin()' is invalid (member reference base type 'int' is not a structure or union)`
- **Constraint tree** (▸ on constrained candidates): see below.
- **Class template specialization:** which pattern each specialization matched.

#### Overload ranking
When several template candidates are viable, the losing ones show why they lost. These are Clang's own ordering rules, evaluated after parsing:

| Reason | Meaning |
|---|---|
| needs a worse conversion | Another candidate needs a cheaper conversion (exact match > promotion > conversion) for some argument |
| worse reference binding | Same conversions, but the winner binds an rvalue to `T&&`, which beats `const T&` |
| less specialized | Both match equally well; partial ordering found the winner more specialized (`f(T*)` over `f(T)`) |
| less constrained | Same signature; the winner's constraints subsume this one's (`std::signed_integral` over `std::integral`) |
| a non-template function won | A non-template matching equally well is preferred over any template |
| arguments cannot bind | Not viable at all, for example an lvalue argument and an rvalue-reference parameter |

#### Constraint tree
For a constrained candidate (C++20 concepts / requires-clauses), the tree shows how Clang evaluated the constraints. It has **all of** (`&&`) and **any of** (`||`) groups, concept-ids expanded into their definitions, and atomic constraints. Each node is marked ✔ satisfied, ✖ not satisfied (with the reason, such as `'sizeof(double) <= 4' evaluated to false`), or · not evaluated because evaluation short-circuited.
- Only template candidates are traced. Non-template overloads also take part in resolution but aren't listed.

### Template Hotspots
Templates grouped by name (`Fib`, `std::is_integral`…) and ranked by **self time**, which excludes nested work. Columns show distinct instantiations, cache reuses and maximum recursion depth. Expand a row to see its specializations in order, with their values: `<6> value=8 → <5> value=5 → …`.

### Compiler Output
Errors and warnings as cards with clickable lines. Each **instantiation backtrace** note ("in instantiation of … requested here") links to its graph card. Errors are also shown as squiggles in the editor. *Show raw* displays the original output.

### Editor gutter
Blue markers show how much template work each line triggers; red marks lines with discarded candidates. Hover a marker for a summary.

### Step Log, Call Stack, Variables, Desugared C++, Flamegraph, Type Resolution
The classic step-by-step views: a narrated log, the instantiation stack at the current step, arguments with changes highlighted, the instantiated source for a class or function body, a time-proportional flamegraph, and alias/typedef resolution chains.

## 6. Examples gallery

| Example | Demonstrates |
|---|---|
| Recursion: Factorial | Recursive instantiation ending at an explicit specialization |
| Memoization: Fibonacci | Cache reuse (♻) keeping recursion linear |
| SFINAE: enable_if overloads | Candidates removed by substitution failure, with reasons |
| C++20 Concepts | Candidates discarded by unmet constraints |
| Partial specialization | Pattern matching on types; which specialization wins |
| Type lists (MP11-style) | Type-level recursion (`filter`), step by step |
| Variadic packs & fold expressions | One instantiation per pack; `index_sequence` |
| CRTP static polymorphism | Separate base instantiations per derived type |
| `if constexpr` dispatch | Only the taken branch is instantiated |

Each example shows a tip telling you what to look at.

## 7. Keyboard shortcuts

| Key | Action |
|---|---|
| ← / → | Step back / forward |
| ↓ | Step over (skip the current subtree) |
| ↑ | Step out to the parent |
| Space | Play / pause |
| Enter (in Find) | Next matching template |
| Double-click a card | Collapse / expand subtree, or expand a folded recursion chain |
| Esc (during the tour) | Skip the tour |

## 8. How it works

```
 Browser (Vue 3)                 Node.js server (Express)            Visualizer (Clang 22 tool)
 ───────────────                 ────────────────────────            ──────────────────────────
 Editor ── POST /api/compile ──▶ writes input.cpp, runs  ──────────▶ parses input.cpp with a
                                 Visualizer, reads trace ◀────────── TemplateInstantiationCallback,
 Graph/Inspector ◀── JSON ────── trace_custom.json                  writes trace_custom.json
 Editor ◀── WebSocket /lsp ───── clangd (autocomplete, hover)
```

### Visualizer (`backend/plugin/`)
A standalone Clang tool built against LLVM 22. It hooks `Sema`'s template instantiation callbacks and records every code-synthesis context started from the main file.

| Source | Responsibility |
|---|---|
| `Visualizer.cpp` | Entry point: tool setup, builtin-header lookup, the AST consumer |
| `src/InstantiationTracer.*` | The Sema callback that builds the causal trace |
| `src/Constraints.*` | Constraint failure descriptions and constraint trees |
| `src/CompileTimeValues.*` | `constexpr` values and the `value` / `type` results of specializations and aliases |
| `src/OverloadRanking.*` | Why each losing viable candidate lost (conversions, binding, partial ordering, constraints) |
| `src/TraceModel.*` | Trace data (nodes, events, reuses) |
| `src/TraceWriter.*` | JSON output |
| `src/ClangHelpers.*` | Naming and classification helpers |

- **Causal nesting:** work done inside static data member initializers (e.g. `Fib<N>::value`) is attributed to the owning specialization.
- **SFINAE:** at the end of a substitution context it asks `Sema::getSFINAEContext()` whether an error was trapped, and reads the suppressed diagnostic from the `TemplateDeductionInfo`.
- **Concepts:** after deduction it inspects `TemplateDeductionInfo::AssociatedConstraintsSatisfaction` and names the failing atomic constraint, concept, or requires-expression requirement.
- **Cache reuse and base cases:** `Memoization` contexts become reuse events. Lookups of explicit specializations become base-case nodes.
- **Partial specialization:** for each class specialization it records all partial specializations and the chosen one.
- **Values:** after parsing, a `RecursiveASTVisitor` evaluates `constexpr` variables and records aliases and typedefs. For traced specializations, Sema lookup finds `value` / `type` (through base classes), and alias templates are re-substituted to report the type they produce.
- **Overload ranking:** after parsing, each call site with several viable template candidates is compared per argument (value category, conversion rank, reference binding). Then `Sema::getMoreSpecializedTemplate` and `Sema::IsAtLeastAsConstrained` decide the remaining ties.
- **Constraint trees:** the candidate's associated constraints are walked as `&&` / `||` / concept-id / atom, and Clang's recorded failures are matched back by source location. Short-circuiting then tells which atoms were evaluated.
- **Builtin headers:** it looks for Clang's builtin headers in `$METATRACE_RESOURCE_DIR`, then `./clang-resource` next to the binary, then the build machine's LLVM. This lets packaged binaries run anywhere.

### Trace format (`trace_custom.json`)

```jsonc
{
  "nodes": [{
    "id": 5, "parentId": 4,              // causal parent (0 = top level)
    "detail": "Fib<3>",                  // entity name (with arguments)
    "kindName": "TemplateInstantiation", // Sema::CodeSynthesisContext kind, or "ExplicitSpecialization"
    "entityKind": "class",               // class | function | alias | concept | variable | other
    "line": 2, "col": 60,                // point of instantiation
    "declLine": 2,                       // where the template is declared (0 = not in main file)
    "ts": 0, "dur": 34,                  // microseconds
    "failed": false, "failKind": "sfinae", "failReason": "...",
    "internal": false,                   // compiler bookkeeping on dependent types
    "specCandidates": [{ "pattern": "Box<T *>", "line": 6, "chosen": true }],
    "results": { "value": "true", "type": "int" },   // computed members / alias result
    "constraints": { "kind": "or", "text": "any of", "result": "false", "children": [ /* ... */ ] },
    "desugaredCode": "struct Fib<3> { ... }"
  }],
  "events":   [{ "type": "Enter", "nodeId": 5 }, { "type": "Leave", "nodeId": 5 }],
  "reuses":   [{ "parentId": 4, "detail": "Fib<2>", "line": 2, "col": 81 }],
  "memoHits": { "Fib<2>": 2 },
  "values":   { "Fib<3>::value": "2" },
  "rankings": [{ "line": 14, "col": 5, "reason": "moreSpecialized", "winner": "pick(int *)", "loser": "pick(int *)",
                 "winnerDeclLine": 4, "loserDeclLine": 3, "details": ["argument 1 (rvalue int *): ..."] }]
}
```

### Frontend (`frontend/src`)
- `store.ts`: ingests the trace in linear time (deduplication, time-travel steps, causal tree). It also holds the derived views: overloads, specializations, hotspots, line heat, diagnostics, graph filtering and playback.
- `kinds.ts`: descriptions of all Clang synthesis kinds, the noise filter, and name prettifying (`std::string`, `lambda@78:17`).
- `components/Graph.vue`: swimlane layout (dagre per lane), card rendering (`MetaNode.vue`, `LaneNode.vue`) and reuse arcs (`ReuseEdge.vue`).
- `InspectorPanel.vue`, `OverloadPanel.vue`, `HotspotsPanel.vue`, `OutputPanel.vue`, `TourOverlay.vue`: the panels described above. `ConstraintTree.vue` renders constraint trees.
- Layout: Golden Layout. Editor: Monaco with an LSP bridge to clangd.

## 9. Building from source

### Prerequisites
- **Node.js** 20+ (CI uses 24)
- **CMake** 3.20+ and **Ninja**
- **LLVM/Clang 22** development files
  - **Windows:** the `clang+llvm-22.x-x86_64-pc-windows-msvc.tar.xz` archive from [LLVM releases](https://github.com/llvm/llvm-project/releases), plus Visual Studio with C++ tools
  - **Linux:** [apt.llvm.org](https://apt.llvm.org): `sudo ./llvm.sh 22 && sudo apt install llvm-22-dev libclang-22-dev libclang-cpp22-dev libpolly-22-dev clang-tools-22`

### One-command build

```bash
npm run install:all

# Windows, from an "x64 Native Tools Command Prompt"
set LLVM_PATH=C:\path\to\llvm-22
npm run build

# Linux
export LLVM_PATH=/usr/lib/llvm-22
npm run build
```

`npm run build` performs these steps:
1. Generates version information.
2. Configures CMake if needed and builds the Visualizer. This also copies Clang's builtin headers to `backend/plugin/clang-resource/`.
3. Builds the frontend and the backend.
4. Packages everything into one executable with `pkg`.

The result goes to `release/`. On Linux, shared LLVM libraries that the Visualizer links against are bundled in `backend/plugin/lib/` and found through its `$ORIGIN/lib` RPATH.

### Building only the Visualizer

```bash
cd backend/plugin
cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -DLLVM_PATH=/path/to/llvm-22 .
cmake --build .
```

On Windows, `DIA_SDK_PATH` is taken from the active Visual Studio (`VSINSTALLDIR`). Pass `-DDIA_SDK_PATH=...` to override it.

### Dev server (hot reload)

```bash
# Terminal 1
cd backend && PORT=8001 npm run dev
# Terminal 2 (BACKEND_PORT must match)
cd frontend && BACKEND_PORT=8001 npm run dev
```

Open http://localhost:5173. Vite proxies `/api` and `/lsp` to the backend.

## 10. Testing

| Suite | Command | What it covers |
|---|---|---|
| Plugin integration | `cd backend && npx jest` | Runs the real Visualizer on classes, functions, SFINAE (including rejection reasons), concepts, variadics, header noise, recursive nesting, overload ranking reasons, constraint trees and computed results |
| Frontend unit | `cd frontend && npm test` | Name parsing, prettifying and the noise filter (Node's built-in test runner) |
| Type-check + build | `cd frontend && npm run build` | `vue-tsc` + Vite production build |
| Packaged smoke test | `node scripts/smoke_test.js release/MetaTrace[.exe]` | Starts the packaged binary, traces a program using `<vector>`/`<string>`/`<type_traits>`, and checks recursion, base cases, SFINAE reasons and `constexpr` values |

## 11. Continuous integration and releases

`.github/workflows/ci.yml` runs on every push to `main`, on pull requests, and on manual dispatch:

| Job | Runner | Steps |
|---|---|---|
| Frontend | Ubuntu 24.04 | `npm ci`, unit tests, type-check and build |
| Linux x64 | Ubuntu 24.04 | Install LLVM 22 from apt.llvm.org, `build.sh`, plugin tests, smoke test, upload `MetaTrace-linux-x64.tar.gz` |
| Windows x64 | Windows Server 2022 | Download and cache the LLVM 22 MSVC archive, MSVC + Ninja, `build_release.js`, plugin tests, smoke test, upload `MetaTrace-windows-x64.zip` |
| Release | Ubuntu 24.04 | Only for tags `v*`: publishes both packages as a GitHub Release with generated notes |

To cut a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| `'stddef.h' file not found` | The Clang builtin headers weren't found. Rebuild the Visualizer (it copies them to `clang-resource/`), or set `METATRACE_RESOURCE_DIR` to your LLVM's `lib/clang/22`. |
| `'vector' file not found` | Install your platform's C++ standard library (Visual Studio C++ tools, or `g++`). |
| Port 80 in use / permission denied | Run with `--port 8080`. |
| Blank page after updating | Click **Reset Layout**, or clear the site's storage. |
| Huge graph | Keep **Simple view** on, enable **Hide std internals**, use **Collapse all** and **Find**. |
| CMake can't find LLVM | Pass `-DLLVM_PATH=` pointing at an LLVM 22 install that contains `lib/cmake/llvm` and `lib/cmake/clang`. |

## Contributing

1. Fork the repository and create a branch (`git checkout -b feature/my-idea`).
2. Make your change and run the tests in [Testing](#10-testing).
3. Open a pull request. CI builds and tests it on Windows and Linux.

Good areas to help with:
- Tracing projects with several files or a `compile_commands.json`
- Diffing two traces to catch compile-time regressions
- Stepping backwards from a compiler error through the instantiations that caused it
- A mini-map and side-by-side graphs for very large traces
- macOS packaging
