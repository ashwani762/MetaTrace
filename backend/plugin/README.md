# MetaTrace Visualizer

`Visualizer.cpp` is a standalone Clang 22 tool. It compiles one translation unit, records every template instantiation, overload candidate and constraint check started from the main file, and writes the result to `trace_custom.json` in the current directory. The backend server runs it for every **Build & Trace**.

```bash
Visualizer input.cpp -- -std=c++20
```

## Building

Requires CMake 3.20+, Ninja, and LLVM/Clang **22** development files.

```bash
cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -DLLVM_PATH=/path/to/llvm-22 .
cmake --build .
```

- **Windows:** run from an *x64 Native Tools Command Prompt*. Use the `clang+llvm-22.x-x86_64-pc-windows-msvc.tar.xz` archive from [LLVM releases](https://github.com/llvm/llvm-project/releases). The DIA SDK path is taken from the active Visual Studio; override it with `-DDIA_SDK_PATH=...`.
- **Linux:** `LLVM_PATH=/usr/lib/llvm-22` after installing LLVM 22 from [apt.llvm.org](https://apt.llvm.org).

The build copies Clang's builtin headers to `clang-resource/` next to the binary. That lets the tool work after it is packaged and moved to another machine.

`npm run build` in the repository root does all of this, then packages the whole app. See the [guide](../../docs/GUIDE.md) for the trace format, architecture and tests.
