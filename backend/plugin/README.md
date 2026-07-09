# MetaTrace Clang Plugin

The `MetaTrace` visualizer relies on a custom LLVM Clang plugin to intercept template instantiations during compilation.

## Building the Plugin

Because every developer's environment is different, you must configure CMake and build this plugin yourself before packaging the app.

### Requirements
- **CMake** (3.15+)
- **LLVM / Clang binaries and headers** (e.g., from [LLVM Releases](https://github.com/llvm/llvm-project/releases))
- A C++17 compatible compiler (MSVC, GCC, Clang)

### 1. Configure CMake
You need to pass the path to your LLVM installation to CMake via the `LLVM_PATH` variable.

**Windows (MSVC Example):**
Open the "x64 Native Tools Command Prompt for VS" and run:
```bat
cmake -G Ninja -DLLVM_PATH="C:/Path/To/LLVM" .
```

**Linux/macOS:**
```bash
cmake -DLLVM_PATH="/path/to/llvm" .
```

### 2. Build the Plugin
Once configured, you can build it manually, or simply run `npm run build` from the project root (the build script will automatically run `cmake --build .` for you).

To build it manually:
```bash
cmake --build . --config Release
```

Once built, the plugin binaries (`.dll`, `.so`, or `.dylib`) will be located in this directory, ready to be loaded by the backend server.
