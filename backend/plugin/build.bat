call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
cmake -G Ninja -DLLVM_PATH="D:/Software/clang" .
ninja
